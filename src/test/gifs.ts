import * as fs from 'fs';

import { PokemonColor } from '../common/types';
import { getAllPokemon, POKEMON_DATA } from '../common/pokemon-data';

const defaultCharacterConfig = {
  colors: [PokemonColor.default],
  states: ['idle', 'walk'],
};

const allPokemon = getAllPokemon().reduce(
  (acc, pokemon) => ({
    ...acc,
    [pokemon]: defaultCharacterConfig,
  }),
  {} as { [key: string]: { colors: string[]; states: string[] } },
);
function checkGifFilenames(folder: string) {
  for (const pokemon in allPokemon) {
    const allowedColors = allPokemon[pokemon].colors;
    const allowedStates = allPokemon[pokemon].states;
    if (!allowedColors) {
      console.error(`No colors found for character "${pokemon}"`);
      return;
    }

    const assetRoot = POKEMON_DATA[pokemon]?.assetRoot || 'custom';

    allowedColors.forEach((color) => {
      allowedStates.forEach((state) => {
        const filename = `${color}_${state}_8fps.gif`;
        const filePath = `${folder}/${assetRoot}/${pokemon}/${filename}`;
        if (!fs.existsSync(filePath)) {
          // \x1b[31m is the ANSI escape code for red, and \x1b[0m resets the color back to the terminal's default.
          console.error(`\x1b[31mFile "${filePath}" does not exist.\x1b[0m`);
          return false;
        } else {
          console.log(`File "${filePath}" exists.`);
        }
      });
    });
  }
}

const mediaFolder = './media';
checkGifFilenames(mediaFolder);
