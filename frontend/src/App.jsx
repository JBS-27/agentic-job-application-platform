// Phase 1 scaffolding — placeholder shell to confirm the frontend boots
// and can reach the backend health endpoint. No resume/job/agent UI yet
// (that arrives in Phase 2+).
import { useEffect, useState } from 'react'

function App() {
  const [status, setStatus] = useState('checking backend...')

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then((res) => res.json())
      .then((data) =>
        setStatus(data.database_connected ? 'Backend + DB OK' : 'Backend OK, DB not connected')
      )
      .catch(() => setStatus('Backend not reachable'))
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Agentic AI Job Application Platform</h1>
      <p>Phase 1: Architecture &amp; Initial Setup</p>
      <p>Status: {status}</p>
    </div>
  )
}

export default App
