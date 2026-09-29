import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installBridge } from './tauri-bridge'

installBridge()

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(<App />)
