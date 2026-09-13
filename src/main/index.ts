import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import type { Theme } from '@shared/types'
import { registerIpcHandlers } from './ipc/handlers'
import { isWebUrl } from './lib/webUrl'
import { getSettings } from './services/store'

/** index.css 의 --background 와 같은 값. 첫 페인트 전에 창이 이 색으로 채워진다 */
const WINDOW_BACKGROUND: Record<Theme, string> = { dark: '#020617', light: '#ffffff' }

function createWindow(theme: Theme): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'PC 정리 도구',
    // 패키징된 앱은 exe 에 박힌 아이콘(build/icon.ico)을 윈도우가 알아서 쓴다. 개발 모드에서만 파일로 준다
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.ico') }),
    // 창이 다른 색으로 번쩍였다가 테마 색이 되는 걸 막는다
    backgroundColor: WINDOW_BACKGROUND[theme],
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // renderer는 Node에 손댈 수 없다. 파일시스템은 전부 main에서만 만진다.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // 외부 링크는 앱 창이 아니라 기본 브라우저로 보낸다. url 은 renderer 가 준 값이라 http(s) 만 넘긴다 —
  // file:·ms-settings: 같은 것은 renderer 의 값으로 열지 않는다(설정 열기는 handlers.ts 의 상수로만)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
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

/**
 * 저장된 테마를 창을 만들기 **전에** 읽는다 — 네이티브 컨트롤(스크롤바·select 목록)과 창 배경색이 첫 프레임부터
 * 맞게. 사용자가 테마를 바꾸면 settings:update 핸들러가 nativeTheme 을 같은 방식으로 따라간다
 */
async function openWindow(): Promise<void> {
  const { theme } = await getSettings()
  nativeTheme.themeSource = theme
  createWindow(theme)
}

void app.whenReady().then(async () => {
  registerIpcHandlers()
  await openWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void openWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
