/* eslint-disable @typescript-eslint/naming-convention */
import { POKEMON_DATA } from './pokemon-data';

export const enum PokemonColor {
  default = 'default',
  null = 'null',
}

export enum PokemonGeneration {
  Custom = 1,
}

export type PokemonTypeString = string & keyof typeof POKEMON_DATA;

export type PokemonType = PokemonTypeString;

export interface PokemonConfig {
  id: number;
  name: string;
  generation: PokemonGeneration;
  cry: string;
  possibleColors: PokemonColor[];
  originalSpriteSize?: number;
  extraSprites?: PokemonExtraSprite[];
  assetRoot?: string;
}

export const enum PokemonExtraSprite {
  leftFacing = 'left_facing',
}

export const enum PokemonSpeed {
  still = 0,
  verySlow = 1,
  slow = 2,
  normal = 3,
  fast = 4,
  veryFast = 5,
}

export const enum PokemonSize {
  nano = 'nano',
  small = 'small',
  medium = 'medium',
  large = 'large',
}

export const enum ExtPosition {
  panel = 'panel',
  explorer = 'explorer',
}

export class WebviewMessage {
  text: string;
  command: string;

  constructor(text: string, command: string) {
    this.text = text;
    this.command = command;
  }
}

export const ALL_COLORS = [PokemonColor.default];
export const ALL_SCALES = [
  PokemonSize.nano,
  PokemonSize.small,
  PokemonSize.medium,
  PokemonSize.large,
];
