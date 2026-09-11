import { BrowserWindow, dialog, ipcMain } from 'electron'
import { CH } from '@shared/channels'
import type { Settings } from '@shared/types'
import { listApps } from '../services/apps'
import { createStructuredCall } from '../lib/anthropic'
import { listDrives } from '../services/drives'
import { advise, buildPlan, previewPlanAdvice } from '../services/plan'
import { runScan } from '../services/scan'
import {
  clearApiKey,
  getApiKey,
  getSettings,
  hasApiKey,
  setApiKey,
  updateSettings
} from '../services/store'

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

  ipcMain.handle(CH.secretsSetApiKey, (_event, key: string) => setApiKey(key))
  ipcMain.handle(CH.secretsHasApiKey, () => hasApiKey())
  ipcMain.handle(CH.secretsClearApiKey, () => clearApiKey())
}
