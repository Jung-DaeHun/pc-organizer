import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpcHandlers } from './ipc/handlers'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'PC 정리 도구',
    // 창이 흰색으로 번쩍였다가 어두워지는 걸 막는다
    backgroundColor: '#020617',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // renderer는 Node에 손댈 수 없다. 파일시스템은 전부 main에서만 만진다.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // 외부 링크는 앱 창이 아니라 기본 브라우저로 보낸다
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 창은 우리 페이지 말고는 아무 데도 가지 않는다. 탐색기에서 파일을 창에 떨어뜨리면 Chromium 이
  // 그 파일(file://)로 이동하는데, preload 가 붙은 채 임의 로컬 HTML 이 열리면 window.api 에
  // 닿는다. renderer 의 dragover/drop 차단이 첫 번째 벽이고 이게 두 번째 벽이다.
  // (새로고침은 같은 URL 이라 통과한다. loadURL/loadFile 은 이 이벤트를 내지 않는다)
  win.webContents.on('will-navigate', (event, url) => {
    const strip = (u: string): string => u.split('#')[0] ?? u
    if (strip(url) !== strip(win.webContents.getURL())) event.preventDefault()
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
