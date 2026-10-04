import { describe, expect, it } from 'vitest'
import { LocalWorkspaceRepository } from '../workspaceRepository'
import type { StorageService } from '../storageService'
import { createInitialDocument } from '../../../shared/models'

function memoryStorage(initial: string | null = null): StorageService {
  let value = initial
  return { read: async () => value, write: async (next) => { value = next } }
}

describe('local workspace repository', () => {
  it('round trips a document', async () => {
    const repository = new LocalWorkspaceRepository(memoryStorage())
    const document = createInitialDocument()
    await repository.save(document)
    await expect(repository.load()).resolves.toEqual(document)
  })

  it('falls back when stored JSON is damaged', async () => {
    const repository = new LocalWorkspaceRepository(memoryStorage('{broken'))
    await expect(repository.load()).resolves.toBeNull()
  })

  it('fills missing refId for documents saved before device identity existed', async () => {
    const document = createInitialDocument()
    const legacy = JSON.parse(JSON.stringify(document)) as { plans: { items: { id: string; refId?: string }[] }[] }
    legacy.plans[0].items.forEach((item) => { delete item.refId })
    const repository = new LocalWorkspaceRepository(memoryStorage(JSON.stringify(legacy)))
    const loaded = await repository.load()
    expect(loaded).not.toBeNull()
    expect(loaded?.plans[0].items.every((item) => typeof item.refId === 'string' && item.refId === item.id)).toBe(true)
  })
})
