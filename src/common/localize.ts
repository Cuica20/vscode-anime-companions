import { POKEMON_DATA } from './pokemon-data';
import { PokemonType } from './types';

export function getLocalizedPokemonName(pokemonType: PokemonType): string {
  return POKEMON_DATA[pokemonType]?.name || pokemonType;
}
