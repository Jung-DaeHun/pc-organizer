import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH } from '@shared/channels'
import type { RendererApi } from '@shared/api'
import type { ExecuteProgress, ExecuteRequest, ScanProgress, Settings } from '@shared/types'

/**
 * sandbox: true 인 preload에서는 Node 모듈을 쓸 수 없다.
 * electron의 ipcRenderer / contextBridge 만으로 다리를 놓는다.
 *
 * renderer가 임의의 채널로 main을 부를 수 없도록, ipcRenderer 자체를 넘기지 않고
 * 필요한 함수만 하나씩 감싸서 내보낸다.
 */
const api: RendererApi = {
  ping: () => ipcRenderer.invoke(CH.ping),

  listDrives: () => ipcRenderer.invoke(CH.drivesList),

  getSettings: () => ipcRenderer.invoke(CH.settingsGet),
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke(CH.settingsUpdate, patch),

  pickFolder: () => ipcRenderer.invoke(CH.foldersPick),

  runScan: () => ipcRenderer.invoke(CH.scanRun),

  onScanProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, progress: ScanProgress): void => callback(progress)
    ipcRenderer.on(CH.scanProgress, listener)
    return () => {
      ipcRenderer.off(CH.scanProgress, listener)
    }
  },

  listApps: () => ipcRenderer.invoke(CH.appsList),

  buildPlan: (root: string, scannedAt: number) =>
    ipcRenderer.invoke(CH.planBuild, root, scannedAt),
  previewAdvice: () => ipcRenderer.invoke(CH.planAdvisePreview),
  advisePlan: () => ipcRenderer.invoke(CH.planAdvise),

  executePlan: (requests: ExecuteRequest[]) => ipcRenderer.invoke(CH.planExecute, requests),
  onExecuteProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, progress: ExecuteProgress): void =>
      callback(progress)
    ipcRenderer.on(CH.planExecuteProgress, listener)
    return () => {
      ipcRenderer.off(CH.planExecuteProgress, listener)
    }
  },
  listUndo: () => ipcRenderer.invoke(CH.undoList),
  runUndo: (id: string) => ipcRenderer.invoke(CH.undoRun, id),

  setApiKey: (key: string) => ipcRenderer.invoke(CH.secretsSetApiKey, key),
  hasApiKey: () => ipcRenderer.invoke(CH.secretsHasApiKey),
  clearApiKey: () => ipcRenderer.invoke(CH.secretsClearApiKey)
}

contextBridge.exposeInMainWorld('api', api)
