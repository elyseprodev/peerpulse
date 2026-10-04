import type { AppNotification, NotificationType } from '@shared/domain'
import { persist, uid, type LocalDatabase } from './db'

export interface NotificationInput {
  uid: string
  type: NotificationType
  title: string
  body: string
  link?: string | null
  priority?: AppNotification['priority']
}

/**
 * Queue a member notification. In Firebase mode this is the job of the
 * `notify` Cloud Function trigger; the local backend emulates it so the bell
 * menu behaves identically in both modes.
 */
export function pushNotification(db: LocalDatabase, input: NotificationInput): AppNotification {
  const id = uid('ntf')
  const notification: AppNotification = {
    id,
    uid: input.uid,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link ?? null,
    read: false,
    priority: input.priority ?? 'normal',
    createdAt: new Date().toISOString(),
  }
  db.notifications[id] = notification
  persist(`notifications|${input.uid}`)
  return notification
}
