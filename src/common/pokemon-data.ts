/* eslint-disable @typescript-eslint/naming-convention */
import {
  PokemonColor,
  PokemonConfig,
  PokemonGeneration,
  PokemonType,
} from './types';

export const POKEMON_DATA: { [key: string]: PokemonConfig } = {
  naruto: {
    id: 1,
    name: 'Naruto',
    generation: PokemonGeneration.Custom,
    cry: 'Believe it!',
    possibleColors: [PokemonColor.default],
    originalSpriteSize: 32,
    assetRoot: 'custom',
  },
  goku: {
    id: 2,
    name: 'Goku',
    generation: PokemonGeneration.Custom,
    cry: 'Kamehameha!',
    possibleColors: [PokemonColor.default],
    originalSpriteSize: 32,
    assetRoot: 'custom',
  },
  sakura: {
    id: 3,
    name: 'Sakura',
    generation: PokemonGeneration.Custom,
    cry: 'Cha!',
    possibleColors: [PokemonColor.default],
    originalSpriteSize: 32,
    assetRoot: 'custom',
  },
};

export function getAllPokemon(): PokemonType[] {
  return Object.keys(POKEMON_DATA) as PokemonType[];
}

export function getPokemonByGeneration(
  generation: PokemonGeneration,
): PokemonType[] {
  return Object.entries(POKEMON_DATA)
    .filter(([, config]) => config.generation === generation)
    .map(([key]) => key as PokemonType);
}

export function getDefaultPokemon(): PokemonType {
  return 'naruto';
}

export function getRandomPokemonConfig(): [PokemonType, PokemonConfig] {
  const keys = Object.keys(POKEMON_DATA);
  const randomKey = keys[Math.floor(Math.random() * keys.length)];
  return [randomKey as PokemonType, POKEMON_DATA[randomKey]];
}
