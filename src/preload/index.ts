import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH } from '@shared/channels'
import type { RendererApi } from '@shared/api'
import type { ScanProgress, Settings } from '@shared/types'

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

  listApps: () => ipcRenderer.invoke(CH.appsList)
}

contextBridge.exposeInMainWorld('api', api)
