// Graph validation (#61, spec criterion 8): every rejection is INVALID_GRAPH
// with a message naming the cycle, the endpoint, the count or the field.
import { describe, expect, it } from 'vitest';
import { parseGraph } from '../../plugin/server/graph/validate.mts';

const skill = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, kind: 'skill', skill: '/x', instruction: `do ${id}`, ...extra });
const graph = (nodes: unknown[], edges: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'g', version: 1, nodes, edges, ...extra });

function rejects(raw: unknown, message: string): void {
  expect(() => parseGraph(raw)).toThrow(expect.objectContaining({ code: 'INVALID_GRAPH', message }) as Error);
}

describe('parseGraph accepts', () => {
  it('a linear graph, with loop defaults filled in', () => {
    const g = parseGraph(graph([skill('a'), { id: 'b', kind: 'loop', skill: '/k', instruction: 'loop' }, { id: 'c', kind: 'human_gate', instruction: 'ok?' }], [['a', 'b'], ['b', 'c']]));
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(g.nodes[1]?.maxIterations).toBe(3);
  });

  it('64 nodes', () => {
    const nodes = Array.from({ length: 64 }, (_, i) => skill(`n${String(i)}`));
    const edges = Array.from({ length: 63 }, (_, i) => [`n${String(i)}`, `n${String(i + 1)}`]);
    expect(parseGraph(graph(nodes, edges)).nodes).toHaveLength(64);
  });

  it('a choice whose options are its direct successors, and a join after them', () => {
    const g = parseGraph(graph(
      [skill('s'), { id: 'c', kind: 'choice', instruction: 'pick', options: { rfc: ['r'], adr: ['d'] } }, skill('r'), skill('d'), skill('j')],
      [['s', 'c'], ['c', 'r'], ['c', 'd'], ['r', 'j'], ['d', 'j']],
    ));
    expect(Object.keys(g.nodes[1]?.options ?? {})).toEqual(['rfc', 'adr']);
  });

  it('an option dictionary with no inherited keys ("constructor" is a valid option name)', () => {
    const g = parseGraph(graph([skill('s'), { id: 'c', kind: 'choice', instruction: 'pick', options: { constructor: ['r'] } }, skill('r')], [['s', 'c'], ['c', 'r']]));
    expect(Object.getPrototypeOf(g.nodes[1]?.options)).toBeNull();
  });
});

describe('parseGraph rejects (criterion 8)', () => {
  it('a cycle, naming it', () => {
    rejects(graph([skill('s'), skill('a'), skill('b'), skill('c')], [['s', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'a']]), 'cycle: a -> b -> c -> a');
  });

  it('a two-node cycle with no start node, naming it', () => {
    rejects(graph([skill('a'), skill('b')], [['a', 'b'], ['b', 'a']]), 'cycle: a -> b -> a');
  });

  it('an unknown edge endpoint, naming it', () => {
    rejects(graph([skill('a'), skill('b')], [['a', 'b'], ['b', 'zzz']]), 'edge b -> zzz: unknown node zzz');
  });

  it('65 nodes, naming the count', () => {
    rejects(graph(Array.from({ length: 65 }, (_, i) => skill(`n${String(i)}`)), []), 'graph has 65 nodes; the limit is 64');
  });

  it.each([
    ['no start node is impossible without a cycle; two start nodes', graph([skill('a'), skill('b')], []), 'graph needs exactly one start node; found 2: a, b'],
    ['a self edge', graph([skill('a')], [['a', 'a']]), 'edge a -> a: a node cannot lead to itself'],
    ['a duplicate edge', graph([skill('a'), skill('b')], [['a', 'b'], ['a', 'b']]), 'duplicate edge a -> b'],
    ['a duplicate node id', graph([skill('a'), skill('a')], []), 'duplicate node id a'],
    ['a bad node id', graph([skill('A')], []), 'nodes[0].id must match ^[a-z0-9-]{1,40}$'],
    ['a bad graph id', { ...graph([skill('a')], []), id: '../x' }, 'graph id must match ^[a-z0-9-]{1,40}$'],
    ['a wrong version', graph([skill('a')], [], { version: 2 }), 'graph g: version must be 1'],
    ['an unknown kind', graph([{ id: 'a', kind: 'parallel', instruction: 'x' }], []), 'node a: kind must be one of skill, choice, loop, human_gate'],
    ['a skill node without a skill', graph([{ id: 'a', kind: 'skill', instruction: 'x' }], []), 'node a: a skill node needs a skill (1 to 200 characters)'],
    ['a gate with a skill', graph([{ id: 'a', kind: 'human_gate', skill: '/x', instruction: 'x' }], []), 'node a: only skill and loop nodes take a skill'],
    ['an empty instruction', graph([skill('a', { instruction: '' })], []), 'node a: instruction must be 1 to 4096 characters'],
    ['options on a skill node', graph([skill('a', { options: { x: ['a'] } })], []), 'node a: only choice nodes take options'],
    ['maxIterations out of range', graph([{ id: 'a', kind: 'loop', skill: '/k', instruction: 'x', maxIterations: 11 }], []), 'node a: maxIterations must be an integer from 1 to 10'],
    ['maxIterations on a skill node', graph([skill('a', { maxIterations: 2 })], []), 'node a: only loop nodes take maxIterations'],
    ['a choice with no options', graph([{ id: 'c', kind: 'choice', instruction: 'x', options: {} }], []), 'node c: a choice needs at least one option'],
    ['an option that is not a direct successor', graph([skill('s'), { id: 'c', kind: 'choice', instruction: 'x', options: { o: ['b'] } }, skill('a'), skill('b')], [['s', 'c'], ['c', 'a'], ['a', 'b']]), 'node c: option o lists b, which is not a direct successor of c'],
    ['a node in two option lists', graph([skill('s'), { id: 'c', kind: 'choice', instruction: 'x', options: { o: ['a'], p: ['a'] } }, skill('a')], [['s', 'c'], ['c', 'a']]), 'node c: option p lists a, which is already in option c.o'],
    ['an option node with another predecessor (condition 11)', graph([skill('s'), { id: 'c', kind: 'choice', instruction: 'x', options: { o: ['a'] } }, skill('a')], [['s', 'c'], ['c', 'a'], ['s', 'a']]), 'node c: option o lists a, which has other predecessors (s); an option node may only follow its choice'],
    ['an option name with an underscore (__proto__)', graph([skill('s'), { id: 'c', kind: 'choice', instruction: 'x', options: JSON.parse('{"__proto__":["a"]}') as unknown }, skill('a')], [['s', 'c'], ['c', 'a']]), 'node c: option name "__proto__" must match ^[a-z0-9-]{1,40}$'],
    ['not an object', [], 'a graph must be a JSON object'],
    ['an edge that is not a pair', graph([skill('a')], [['a']]), 'edges[0] must be a [from, to] pair of node ids'],
  ])('%s', (_name, raw, message) => {
    rejects(raw, message);
  });
});
