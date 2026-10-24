import type { Sde } from '../data/sde';
import { findCharacter, getActiveCharacterId, setActiveCharacterId, type Character } from '../character/characters';

type Listener = () => void;

export class AppContext {
  private listeners = new Set<Listener>();
  private current: Character;

  constructor(readonly sde: Sde) {
    this.current = findCharacter(sde, getActiveCharacterId());
  }

  get character(): Character {
    return this.current;
  }

  setCharacter(id: string) {
    setActiveCharacterId(id);
    this.reloadCharacters();
  }

  reloadCharacters() {
    this.current = findCharacter(this.sde, getActiveCharacterId());
    this.listeners.forEach((fn) => fn());
  }

  onCharacterChange(fn: Listener) {
    this.listeners.add(fn);
  }
}
