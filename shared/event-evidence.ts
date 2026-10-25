/** 从固定轨迹重算消息语义；该计算本身不认证外来进程。 */
import { eventWorkerInput, eventWorkerOutput } from './contracts/suite-execution-event.ts';
import type { z } from 'zod';
export function evaluateEventEvidence(rawInput: unknown, rawOutput: unknown) {
  const input = eventWorkerInput.parse(rawInput),
    output = eventWorkerOutput.parse(rawOutput),
    findings: string[] = [];
  const ids = new Set(input.messages.map((m) => m.id)),
    counts = (kind: string) => output.trace.filter((row) => row.kind === kind).length;
  const deliveries = new Map<
    string,
    { id: string; intent: boolean; effect: boolean; deduplicated: boolean; terminal: string | null }
  >();
  const produced = new Set<string>(),
    queues: { id: string; attempts: number; state: 'ready' | 'active' | 'acked' | 'dead' }[] = [],
    applied = new Map<string, number>();
  let last = 0n;
  for (const [rowIndex, row] of output.trace.entries()) {
    if (row.sequence !== rowIndex + 1 || BigInt(row.atNs) < last) throw new Error('EVENT_TRACE_ORDER');
    last = BigInt(row.atNs);
    if (!ids.has(row.messageId)) throw new Error('EVENT_TRACE_MESSAGE');
    if (row.kind === 'produce') {
      if (produced.has(row.messageId) || row.attempt !== 0 || row.deliveryId !== null)
        throw new Error('EVENT_PRODUCE_DUPLICATE');
      produced.add(row.messageId);
      continue;
    }
    if (row.kind === 'enqueue') {
      if (!produced.has(row.messageId) || row.attempt !== 0 || row.deliveryId !== null)
        throw new Error('EVENT_ENQUEUE_BINDING');
      queues.push({ id: row.messageId, attempts: 0, state: 'ready' });
      continue;
    }
    const identity = row.deliveryId?.match(/^([1-9][0-9]*):([1-9][0-9]*)$/),
      queue = identity ? queues[Number(identity[1]) - 1] : undefined;
    if (!identity || !queue || queue.id !== row.messageId || Number(identity[2]) !== row.attempt)
      throw new Error('EVENT_QUEUE_BINDING');
    if (row.kind === 'deliver') {
      if (
        !row.deliveryId ||
        deliveries.has(row.deliveryId) ||
        queue.state !== 'ready' ||
        row.attempt !== queue.attempts + 1 ||
        row.attempt > input.retryLimit + 1
      )
        throw new Error('EVENT_DELIVERY_ID');
      queue.attempts = row.attempt;
      queue.state = 'active';
      deliveries.set(row.deliveryId, {
        id: row.messageId,
        intent: false,
        effect: false,
        deduplicated: false,
        terminal: null,
      });
      continue;
    }
    if (row.kind === 'dead-letter') {
      if (
        queue.state !== 'ready' ||
        queue.attempts !== input.retryLimit + 1 ||
        row.attempt !== queue.attempts
      )
        throw new Error('EVENT_DEAD_LETTER');
      queue.state = 'dead';
      continue;
    }
    if (['effect', 'effect-applied', 'deduplicate', 'ack', 'ack-lost', 'reject'].includes(row.kind)) {
      const delivery = row.deliveryId ? deliveries.get(row.deliveryId) : undefined;
      if (
        !delivery ||
        delivery.id !== row.messageId ||
        delivery.terminal ||
        queue.state !== 'active' ||
        queue.attempts !== row.attempt
      )
        throw new Error('EVENT_DELIVERY_BINDING');
      if (row.kind === 'effect') {
        if (
          delivery.intent ||
          delivery.effect ||
          delivery.deduplicated ||
          input.poisonIds.includes(row.messageId) ||
          (input.idempotent && (applied.get(row.messageId) ?? 0) > 0)
        )
          throw new Error('EVENT_EFFECT_INTENT');
        delivery.intent = true;
      }
      if (row.kind === 'effect-applied') {
        if (!delivery.intent || delivery.effect || delivery.deduplicated)
          throw new Error('EVENT_EFFECT_DUPLICATE');
        delivery.effect = true;
        applied.set(row.messageId, (applied.get(row.messageId) ?? 0) + 1);
      }
      if (row.kind === 'deduplicate') {
        if (
          delivery.intent ||
          delivery.effect ||
          delivery.deduplicated ||
          !input.idempotent ||
          !(applied.get(row.messageId) ?? 0)
        )
          throw new Error('EVENT_DEDUPLICATE');
        delivery.deduplicated = true;
      }
      if (row.kind === 'ack' || row.kind === 'ack-lost') {
        if (!delivery.effect && !delivery.deduplicated) throw new Error('EVENT_ACK_WITHOUT_EFFECT');
        if (row.kind === 'ack-lost' && (input.experiment !== 'ack-loss' || row.attempt !== 1))
          throw new Error('EVENT_ACK_LOSS');
        delivery.terminal = row.kind;
        queue.state = row.kind === 'ack' ? 'acked' : 'ready';
      }
      if (row.kind === 'reject') {
        if (
          delivery.intent ||
          delivery.effect ||
          delivery.deduplicated ||
          !input.poisonIds.includes(row.messageId)
        )
          throw new Error('EVENT_REJECTION');
        delivery.terminal = row.kind;
        queue.state = 'ready';
      }
    }
  }
  if (
    output.produced !== input.messages.length ||
    counts('produce') !== output.produced ||
    counts('enqueue') !== input.messages.length * (input.experiment === 'duplicate-delivery' ? 2 : 1) ||
    counts('deliver') !== output.delivered ||
    counts('ack') !== output.acknowledged ||
    counts('deduplicate') !== output.deduplicated ||
    counts('dead-letter') !== output.deadLetters ||
    queues.filter((queue) => queue.state === 'ready' || queue.state === 'active').length !==
      output.remaining ||
    input.messages.some(
      (message) =>
        queues.filter((queue) => queue.id === message.id).length !==
        (input.experiment === 'duplicate-delivery' ? 2 : 1),
    )
  )
    throw new Error('EVENT_TRACE_COUNTS');
  const first = [...new Set(output.trace.filter((r) => r.kind === 'deliver').map((r) => r.messageId))],
    expected = (
      input.ordering === 'fifo'
        ? input.messages
        : [...input.messages].sort((a, b) =>
            a.key < b.key ? -1 : a.key > b.key ? 1 : input.messages.indexOf(a) - input.messages.indexOf(b),
          )
    ).map((m) => m.id);
  if (first.some((id, i) => id !== expected[i])) findings.push('首次投递不满足声明的顺序范围。');
  const effects = new Map(output.effects.map((row) => [row.messageId, row]));
  if (
    effects.size !== output.effects.length ||
    effects.size !== applied.size ||
    output.effects.some(
      (row) => !ids.has(row.messageId) || row.key !== input.messages.find((m) => m.id === row.messageId)!.key,
    )
  )
    throw new Error('EVENT_EFFECT_BINDING');
  for (const effect of output.effects) {
    if (
      output.trace.filter((r) => r.kind === 'effect-applied' && r.messageId === effect.messageId).length !==
      effect.count
    )
      throw new Error('EVENT_EFFECT_COUNTS');
    if (effect.count !== 1) findings.push('消息 ' + effect.messageId + ' 产生了重复应用结果。');
  }
  if (output.deadLetters) findings.push(output.deadLetters + ' 次投递耗尽重试并进入死信。');
  if (output.remaining) findings.push(output.remaining + ' 条队列记录在截止前未完成。');
  const missing = input.messages.filter((m) => !effects.has(m.id));
  if (missing.length) findings.push(missing.length + ' 条消息没有已确认应用结果。');
  const incomplete = output.remaining > 0 || counts('effect') !== counts('effect-applied');
  const outcome: z.infer<typeof eventWorkerOutput>['outcome'] = incomplete
    ? 'inconclusive'
    : findings.length
      ? 'failed'
      : 'passed';
  if (output.outcome !== outcome) throw new Error('EVENT_RESULT_OUTCOME');
  return {
    outcome,
    findings: findings.slice(0, 100),
    coverage: incomplete ? ('incomplete' as const) : ('complete' as const),
    produced: output.produced,
    delivered: output.delivered,
    acknowledged: output.acknowledged,
    deduplicated: output.deduplicated,
    deadLetters: output.deadLetters,
    remaining: output.remaining,
  };
}
