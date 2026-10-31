import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { EVENTS, eventEmitter } from '@/utils/events'

interface Account {
  id: string
  name: string
}

interface AccountsStore {
  accounts: Account[]
  currentAccountId: string
  addAccount: (name: string) => void
  removeAccount: (id: string) => void
  switchAccount: (id: string) => void
  getCurrentAccount: () => Account | undefined
  updateAccountName: (id: string, name: string) => void
  /** 拖拽排序：传入按新顺序排列的账号 id 列表，重排持久化（immer + persist 自动落盘） */
  reorderAccounts: (orderedIds: string[]) => void
}

export const useAccounts = create<AccountsStore>()(
  persist(
    immer((set, get) => ({
      accounts: [{ id: 'default', name: '默认账号' }],
      currentAccountId: 'default',

      addAccount: (name: string) => {
        set(state => {
          const newId = crypto.randomUUID()
          state.accounts.push({
            id: newId,
            name,
          })
          eventEmitter.emit(EVENTS.ACCOUNT_ADDED, newId, name)
        })
      },

      removeAccount: (id: string) => {
        set(state => {
          // 2026-10-31 放宽：原来硬拦 `id === 'default'`，导致「默认账号」永远删不掉
          // （用户把第一个账号改名成「视频号」后，想删也删不了）。
          // 真正的约束只有一条：**至少要留一个账号**——整个应用都假设存在当前账号。
          if (state.accounts.length <= 1) return
          state.accounts = state.accounts.filter(acc => acc.id !== id)
          if (state.currentAccountId === id) {
            state.currentAccountId = state.accounts[0]?.id ?? 'default'
          }
          eventEmitter.emit(EVENTS.ACCOUNT_REMOVED, id)
        })
      },

      switchAccount: (id: string) => {
        set(state => {
          state.currentAccountId = id
          eventEmitter.emit(EVENTS.ACCOUNT_SWITCHED, id)
        })
      },

      getCurrentAccount: () => {
        return get().accounts.find(acc => acc.id === get().currentAccountId)
      },

      updateAccountName: (id: string, name: string) => {
        set(state => {
          const account = state.accounts.find(acc => acc.id === id)
          if (account) {
            account.name = name
            // eventEmitter.emit(EVENTS.ACCOUNT_UPDATED, id, name)
          }
        })
      },

      reorderAccounts: (orderedIds: string[]) => {
        set(state => {
          const byId = new Map(state.accounts.map(a => [a.id, a]))
          const next: Account[] = []
          for (const id of orderedIds) {
            const acc = byId.get(id)
            if (acc) {
              next.push(acc)
              byId.delete(id)
            }
          }
          // 兜底：把没出现在 orderedIds 里的账号（极端情况）追加到末尾，避免丢失
          for (const acc of byId.values()) next.push(acc)
          state.accounts = next
        })
      },
    })),
    {
      name: 'accounts-storage',
    },
  ),
)
