import { lstat, mkdir, rename, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { CH } from '@shared/channels'
import type { ExecuteRequest, Settings } from '@shared/types'
import { listApps } from '../services/apps'
import { createStructuredCall } from '../lib/anthropic'
import { listDrives } from '../services/drives'
import type { ExecutorIo } from '../services/executor'
import { advise, buildPlan, executeApproved, previewPlanAdvice } from '../services/plan'
import { runScan } from '../services/scan'
import {
  clearApiKey,
  getApiKey,
  getSettings,
  hasApiKey,
  setApiKey,
  updateSettings
} from '../services/store'
import { listUndoEntries, undoExecution } from '../services/undo'

/**
 * 사용자 파일에 쓰는 호출은 **이 객체 하나로 모인다.** 서비스(executor.ts)는 이걸 주입받아 쓰고
 * fs 를 직접 부르지 않는다. 사용자 파일을 지우는 호출(unlink·rm)은 없다 — 폴더 생성은 mkdir, 이동은
 * rename, 그리고 실행취소가 자기가 만든 **빈** 폴더를 치우는 rmdir 뿐이다.
 * mkdir 은 recursive 없이 한 단계만 만들고(폴더 이름은 검증을 거쳐 구분자가 없다), rmdir 은 옵션 없이
 * 불러 비어 있지 않으면 ENOTEMPTY 로 실패한다 — recursive 를 붙이는 순간 사용자 파일이 지워질 수 있다.
 */
const executorIo: ExecutorIo = {
  lstat,
  mkdir: (path) => mkdir(path),
  rename,
  rmdir: (path) => rmdir(path)
}

/** 실행 기록. settings.json·secrets.json 과 같은 userData 아래 */
const journalPath = (): string => join(app.getPath('userData'), 'journal.json')

/**
 * 모든 IPC 핸들러를 한곳에서 등록한다.
 * 여기서는 채널과 서비스 함수를 연결만 하고, 실제 로직은 services/ 아래에 둔다.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(CH.ping, () => 'pong')

  ipcMain.handle(CH.drivesList, () => listDrives())

  ipcMain.handle(CH.settingsGet, () => getSettings())
  ipcMain.handle(CH.settingsUpdate, (_event, patch: Partial<Settings>) => updateSettings(patch))

  ipcMain.handle(CH.foldersPick, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const], title: '정리 대상 폴더 선택' }

    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(CH.scanRun, (event) =>
    runScan((progress) => {
      // 스캔 도중 창이 닫히면 send가 예외를 던진다
      if (!event.sender.isDestroyed()) event.sender.send(CH.scanProgress, progress)
    })
  )

  ipcMain.handle(CH.appsList, () => listApps())

  ipcMain.handle(CH.planBuild, (_event, root: string, scannedAt: number) =>
    buildPlan(root, scannedAt)
  )
  ipcMain.handle(CH.planAdvisePreview, () => previewPlanAdvice())

  ipcMain.handle(CH.planAdvise, async () => {
    // 키는 여기서 클라이언트를 만드는 데만 쓰고 서비스로 넘기지 않는다
    const apiKey = await getApiKey()
    if (!apiKey) throw new Error('먼저 설정에서 API 키를 저장하세요')
    return advise(createStructuredCall(apiKey))
  })

  // 실행 · 실행취소 — 쓰기 I/O 가 실체화되는 유일한 곳
  ipcMain.handle(CH.planExecute, (event, requests: ExecuteRequest[]) =>
    executeApproved(requests, {
      io: executorIo,
      journalPath: journalPath(),
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(CH.planExecuteProgress, progress)
      }
    })
  )
  ipcMain.handle(CH.undoList, () => listUndoEntries(journalPath()))
  ipcMain.handle(CH.undoRun, (_event, id: string) => undoExecution(id, executorIo, journalPath()))

  ipcMain.handle(CH.secretsSetApiKey, (_event, key: string) => setApiKey(key))
  ipcMain.handle(CH.secretsHasApiKey, () => hasApiKey())
  ipcMain.handle(CH.secretsClearApiKey, () => clearApiKey())
}
