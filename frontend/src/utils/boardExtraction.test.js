// The helpers the V3 board shares with the V2 moved to utils/. The V2 files keep
// exporting them under the old path, and both paths must hand out the SAME
// function or constant (the V2 tests and mocks import by the old path).
import { describe, it, expect } from 'vitest'
import * as dndIdsOld from '../components/board/SortableBoardCard.jsx'
import * as dropzoneOld from '../components/board/SortableBoardColumn.jsx'
import * as attachmentsOld from '../components/board/CardAttachments.jsx'
import * as questionsOld from '../components/board/CardQuestions.jsx'
import * as badgeOld from '../components/board/CardIdBadge.jsx'
import * as dndIds from './boardDndIds.js'
import * as attachments from './cardAttachments.js'
import * as questions from './cardQuestions.js'
import * as cardMeta from './cardMeta.js'

describe('extraction by the old and the new path', () => {
  it('card drag ids are the same', () => {
    for (const name of ['CARD_DND_ID_PREFIX', 'cardDndId', 'isCardDndId', 'cardIdFromDndId']) {
      expect(dndIdsOld[name], name).toBe(dndIds[name])
    }
  })

  it('drop-zone ids are the same', () => {
    for (const name of ['COLUMN_DROPZONE_ID_PREFIX', 'columnDropzoneId', 'isColumnDropzoneId', 'slugFromColumnDropzoneId']) {
      expect(dropzoneOld[name], name).toBe(dndIds[name])
    }
  })

  it('attachment limits are the same', () => {
    expect(attachmentsOld.MAX_ATTACHMENTS).toBe(attachments.MAX_ATTACHMENTS)
    expect(attachmentsOld.isPreviewable).toBe(attachments.isPreviewable)
  })

  it('pending questions counter is the same', () => {
    expect(questionsOld.countPendingQuestions).toBe(questions.countPendingQuestions)
  })

  it('card id formatter is the same', () => {
    expect(badgeOld.formatCardId).toBe(cardMeta.formatCardId)
  })
})

describe('behaviour that must not change', () => {
  it('builds and parses the sortable ids', () => {
    expect(dndIds.cardDndId(12)).toBe('card:12')
    expect(dndIds.isCardDndId('card:12')).toBe(true)
    expect(dndIds.isCardDndId('em_andamento')).toBe(false)
    expect(dndIds.cardIdFromDndId('card:12')).toBe(12)
    expect(dndIds.cardIdFromDndId('card:abc')).toBeNull()
    expect(dndIds.cardIdFromDndId('dropzone:feito')).toBeNull()
    expect(dndIds.columnDropzoneId('feito')).toBe('dropzone:feito')
    expect(dndIds.slugFromColumnDropzoneId('dropzone:feito')).toBe('feito')
    expect(dndIds.slugFromColumnDropzoneId('card:1')).toBeNull()
  })

  it('keeps the attachment rules', () => {
    expect(attachments.MAX_ATTACHMENTS).toBe(10)
    expect(attachments.isPreviewable('notes.MD')).toBe(true)
    expect(attachments.isPreviewable('archive.zip')).toBe(false)
    expect(attachments.isPreviewable(undefined)).toBe(false)
  })

  it('counts only the questions without an answer', () => {
    expect(questions.countPendingQuestions([{ answer: 'x' }, { answer: '' }, {}])).toBe(2)
    expect(questions.countPendingQuestions(undefined)).toBe(0)
  })

  it('formats the card id with a hash', () => {
    expect(cardMeta.formatCardId(128)).toBe('#128')
  })
})
