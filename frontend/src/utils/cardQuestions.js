// Pure helpers over the agent questions of a card; shared by the V2 card modal and the V3 board.

export function countPendingQuestions(questions) {
  return (questions || []).filter((q) => !q.answer).length;
}
