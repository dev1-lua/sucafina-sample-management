import { ACTOR_STORAGE_KEY, actorHeader, getActorName, setActorName } from './actor';

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  setActorName(null);
});

it('sends a bare "dashboard" actor until a name is known', () => {
  expect(getActorName()).toBeNull();
  expect(actorHeader()).toBe('dashboard');
});

it('formats the header as dashboard:<Name> and persists the trimmed name', () => {
  setActorName('  Harriet Muthoni ');
  expect(getActorName()).toBe('Harriet Muthoni');
  expect(actorHeader()).toBe('dashboard:Harriet Muthoni');
  expect(localStorage.getItem(ACTOR_STORAGE_KEY)).toBe('Harriet Muthoni');
});

it('clearing (null or blank) removes the stored name and reverts the header', () => {
  setActorName('Ivo');
  setActorName('   ');
  expect(getActorName()).toBeNull();
  expect(localStorage.getItem(ACTOR_STORAGE_KEY)).toBeNull();
  expect(actorHeader()).toBe('dashboard');
});

it('falls back to an in-memory name when storage throws (private mode / blocked site data)', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage blocked');
  });
  expect(getActorName()).toBeNull();
  expect(actorHeader()).toBe('dashboard');
  expect(() => setActorName('Ivo')).not.toThrow();
  expect(getActorName()).toBe('Ivo');
  expect(actorHeader()).toBe('dashboard:Ivo');
});
