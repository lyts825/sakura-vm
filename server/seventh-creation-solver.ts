/** 整数模型独立赋值校验；independently checks bounded integer assignments using exact sums. */
import { type Data, integer, number, object, reject, rows, text, unique } from './seventh-creation-common.ts';

function exact(value: unknown) {
  const v = number(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(v)) reject('SOLVE_INTEGER_COEFFICIENT');
  return BigInt(v);
}
export function validateIntegerModel(input: Data) {
  const variables = rows(input.variables, 5000);
  if (!variables.length) reject('SOLVE_EMPTY_MODEL');
  const ids = variables.map((v) => text(v.id));
  unique(ids);
  const known = new Set(ids);
  for (const v of variables) if (exact(v.min ?? 0) > exact(v.max ?? 1)) reject('SOLVE_EMPTY_DOMAIN');
  const constraints = rows(input.constraints ?? [], 20000);
  let terms = 0;
  for (const constraint of constraints) {
    if (!['eq', 'lte', 'gte'].includes(text(constraint.op))) reject('SOLVE_CONSTRAINT_OPERATOR');
    exact(constraint.rhs);
    for (const [id, value] of Object.entries(object(constraint.terms))) {
      if (!known.has(id)) reject('SOLVE_UNKNOWN_VARIABLE');
      exact(value);
      terms++;
    }
  }
  const objective = object(input.objective ?? { terms: {} });
  for (const [id, value] of Object.entries(object(objective.terms ?? {}))) {
    if (!known.has(id)) reject('SOLVE_UNKNOWN_VARIABLE');
    exact(value);
    terms++;
  }
  if (terms > 100000) reject('SOLVE_TERM_LIMIT');
  return { variables, constraints, objective, ids, terms };
}
export function computeSolver(action: string, input: Data): unknown {
  const model = validateIntegerModel(input);
  if (['constraints.checkTypes', 'domains.validate', 'objectives.validate'].includes(action))
    return {
      passed: true,
      variables: model.variables.length,
      constraints: model.constraints.length,
      nonzeroTerms: model.terms,
    };
  if (action === 'conflicts.analyze') {
    const max = 100000;
    let nodes = 0,
      work = 0;
    const assignment: Data = {};
    let interrupted = false;
    let combinations = 1n;
    const branches: typeof model.variables = [];
    for (const variable of model.variables) {
      const lower = exact(variable.min ?? 0),
        upper = exact(variable.max ?? 1);
      if (lower === upper) assignment[text(variable.id)] = Number(lower);
      else {
        branches.push(variable);
        combinations *= upper - lower + 1n;
      }
      if (combinations > BigInt(max))
        return {
          state: 'inconclusive',
          conflict: [],
          minimal: false,
          visited: 0,
          reason: 'enumeration-domain-limit',
        };
    }
    const budget = Symbol('budget');
    const hasSolution = (constraints: typeof model.constraints): boolean | undefined => {
      const search = (index: number): boolean | undefined => {
        if (++nodes > max) {
          interrupted = true;
          return undefined;
        }
        if (index === branches.length)
          return constraints.every((constraint) => {
            const lhs = Object.entries(object(constraint.terms)).reduce((s, [id, c]) => {
                if (++work > 5000000) throw budget;
                return s + exact(c) * exact(assignment[id]);
              }, 0n),
              rhs = exact(constraint.rhs);
            return constraint.op === 'eq' ? lhs === rhs : constraint.op === 'lte' ? lhs <= rhs : lhs >= rhs;
          });
        const v = branches[index],
          id = text(v.id);
        const start = Number(exact(v.min ?? 0)),
          end = Number(exact(v.max ?? 1));
        for (let n = start; n <= end; n++) {
          assignment[id] = n;
          const result = search(index + 1);
          if (result !== false) return result;
        }
        return false;
      };
      try {
        return search(0);
      } catch (error) {
        if (error !== budget) throw error;
        interrupted = true;
        return undefined;
      }
    };
    const possible = hasSolution(model.constraints);
    if (possible === true) return { state: 'feasible', conflict: [], minimal: false, visited: nodes };
    if (possible === undefined)
      return {
        state: 'inconclusive',
        conflict: [],
        minimal: false,
        visited: nodes,
        reason: 'enumeration-budget',
      };
    let core = [...model.constraints];
    for (const constraint of model.constraints) {
      const trial = core.filter((c) => c !== constraint);
      const result = hasSolution(trial);
      if (result === false) core = trial;
      if (result === undefined) break;
    }
    return {
      state: 'infeasible',
      conflict: core.map((constraint, i) => ({
        id: constraint.id ?? String(model.constraints.indexOf(constraint)),
        constraint,
      })),
      minimal: !interrupted,
      minimality: interrupted ? 'not-proven' : 'inclusion-minimal in the fully enumerated bounded domain',
      visited: nodes,
    };
  }
  if (action === 'validation.verify') {
    const assignment = object(input.assignment);
    const failures: Data[] = [];
    for (const v of model.variables) {
      const value = exact(assignment[text(v.id)]);
      if (value < exact(v.min ?? 0) || value > exact(v.max ?? 1)) failures.push({ id: v.id, code: 'DOMAIN' });
    }
    const checks = model.constraints.map((c, i) => {
      const lhs = Object.entries(object(c.terms)).reduce(
        (sum, [id, value]) => sum + exact(value) * exact(assignment[id]),
        0n,
      );
      const rhs = exact(c.rhs);
      const passed = c.op === 'eq' ? lhs === rhs : c.op === 'lte' ? lhs <= rhs : lhs >= rhs;
      if (!passed)
        failures.push({
          id: c.id ?? String(i),
          code: 'CONSTRAINT',
          lhs: lhs.toString(),
          rhs: rhs.toString(),
        });
      return { id: c.id ?? String(i), lhs: lhs.toString(), rhs: rhs.toString(), passed };
    });
    const objective = Object.entries(object(model.objective.terms ?? {})).reduce(
      (sum, [id, value]) => sum + exact(value) * exact(assignment[id]),
      0n,
    );
    return {
      passed: failures.length === 0,
      failures,
      checks,
      objective: objective.toString(),
      optimality: 'not-reproved',
    };
  }
  reject('CREATION_ACTION_UNSUPPORTED');
}
