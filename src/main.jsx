import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import logger from './utils/logger-frontend'
import { CommitDataProvider } from './contexts/CommitDataContext'

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        logger.log('Service Worker registered:', registration)
      })
      .catch((error) => {
        logger.error('Service Worker registration failed:', error)
      })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CommitDataProvider>
      <App />
    </CommitDataProvider>
  </React.StrictMode>,
) 