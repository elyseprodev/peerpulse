import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Security/UX niceties: log the active backend once so operators can tell at a
// glance which data source a deployment is using.
import('./lib/env').then(({ env }) => {
  console.info(
    `%cPeerPulse%c backend: ${env.backendMode}${env.backendMode === 'firebase' ? ` (${env.firebase.projectId || 'unconfigured'})` : ' (in-browser reference backend)'}`,
    'background:#10B981;color:#04231a;padding:2px 6px;border-radius:6px;font-weight:700',
    'color:#A7BBC8',
  )
})
