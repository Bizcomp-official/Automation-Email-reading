import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { batchesRouter } from './routes/batches'
import { ordersRouter } from './routes/orders'
import { summaryRouter } from './routes/summary'
import { ingestRouter } from './routes/ingest'

const app = express()
const PORT = process.env.PORT ?? 4000

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3000' }))
app.use(express.json())

app.use('/api/batches', batchesRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/summary', summaryRouter)
app.use('/api/ingest', ingestRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`FC API running on http://localhost:${PORT}`)
})
