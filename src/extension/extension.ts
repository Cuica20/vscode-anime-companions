import * as vscode from 'vscode';
import * as path from 'path';
import { randomName } from '../common/names';
import {
  getDefaultPokemon as getDefaultPokemonType,
  POKEMON_DATA,
} from '../common/pokemon-data';
import {
  ALL_COLORS,
  ALL_SCALES,
  ExtPosition,
  PokemonColor,
  PokemonSize,
  PokemonType,
  WebviewMessage,
} from '../common/types';
import { availableColors, normalizeColor } from '../panel/pokemon-collection';

const EXTRA_POKEMON_KEY = 'vscode-anime-companions.extra-pokemon';
const EXTRA_POKEMON_KEY_TYPES = EXTRA_POKEMON_KEY + '.types';
const EXTRA_POKEMON_KEY_COLORS = EXTRA_POKEMON_KEY + '.colors';
const EXTRA_POKEMON_KEY_NAMES = EXTRA_POKEMON_KEY + '.names';
const DEFAULT_POKEMON_SCALE = PokemonSize.medium;
const DEFAULT_COLOR = PokemonColor.default;
const DEFAULT_POKEMON_TYPE = getDefaultPokemonType();
const DEFAULT_POSITION = ExtPosition.panel;
const CUSTOM_CHARACTER_STORAGE_FOLDER = 'custom-characters';

interface IUserCharacterConfig {
  type: string;
  name?: string;
  idleGif: string;
  walkGif: string;
  animationGifs?: { [animationLabel: string]: string };
  originalSpriteSize?: number;
}

interface ICharacterDefinition {
  type: PokemonType;
  name: string;
  originalSpriteSize: number;
  isUserConfigured: boolean;
  idleGif?: vscode.Uri;
  walkGif?: vscode.Uri;
  animationGifs?: { [animationLabel: string]: vscode.Uri };
}

interface IWebviewCharacterAssets {
  [type: string]: {
    idle: string;
    walk: string;
    [animationLabel: string]: string;
  };
}

class PokemonQuickPickItem implements vscode.QuickPickItem {
  constructor(
    public readonly name_: string,
    public readonly type: string,
    public readonly color: string,
  ) {
    this.name = name_;
    this.label = name_;
    this.description = `${color} ${type}`;
  }

  name: string;
  label: string;
  kind?: vscode.QuickPickItemKind | undefined;
  description?: string | undefined;
  detail?: string | undefined;
  picked?: boolean | undefined;
  alwaysShow?: boolean | undefined;
  buttons?: readonly vscode.QuickInputButton[] | undefined;
}

let webviewViewProvider: PokemonWebviewViewProvider;

function getCustomCharactersConfig(): IUserCharacterConfig[] {
  const configs = vscode.workspace
    .getConfiguration('vscode-anime-companions')
    .get<IUserCharacterConfig[]>('customCharacters', []);

  return Array.isArray(configs) ? configs : [];
}

function resolveConfiguredGifPath(configPath: string): vscode.Uri | undefined {
  if (!configPath || !configPath.trim()) {
    return undefined;
  }

  const expandedPath = configPath.replace(
    /^~(?=$|[\\/])/,
    process.env.HOME ?? '',
  );

  if (path.isAbsolute(expandedPath)) {
    return vscode.Uri.file(expandedPath);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  return vscode.Uri.joinPath(workspaceFolder.uri, expandedPath);
}

function resolveConfiguredAnimationGifs(
  animationGifs: IUserCharacterConfig['animationGifs'],
): { [animationLabel: string]: vscode.Uri } {
  const result: { [animationLabel: string]: vscode.Uri } = {};

  if (!animationGifs || typeof animationGifs !== 'object') {
    return result;
  }

  for (const [animationLabel, gifPath] of Object.entries(animationGifs)) {
    const label = animationLabel.trim();
    if (!label || typeof gifPath !== 'string') {
      continue;
    }

    const uri = resolveConfiguredGifPath(gifPath);
    if (uri) {
      result[label] = uri;
    }
  }

  return result;
}

function getConfiguredUserCharacters(): ICharacterDefinition[] {
  const configs = getCustomCharactersConfig();

  const seen = new Set<string>();
  const result: ICharacterDefinition[] = [];

  if (!Array.isArray(configs)) {
    return result;
  }

  for (const config of configs) {
    const type = config.type?.trim();
    if (!type) {
      console.warn('Invalid custom character: missing type');
      continue;
    }

    if (seen.has(type)) {
      console.warn(`Duplicate custom character type ignored: ${type}`);
      continue;
    }

    const idleGif = resolveConfiguredGifPath(config.idleGif);
    const walkGif = resolveConfiguredGifPath(config.walkGif);
    const animationGifs = resolveConfiguredAnimationGifs(config.animationGifs);

    if (!idleGif || !walkGif) {
      console.warn(`Invalid custom character paths for: ${type}`);
      continue;
    }

    seen.add(type);
    result.push({
      type: type as PokemonType,
      name: config.name?.trim() || type,
      originalSpriteSize: config.originalSpriteSize || 32,
      isUserConfigured: true,
      idleGif,
      walkGif,
      animationGifs,
    });
  }

  return result;
}

function slugifyCharacterType(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'custom-character';
}

function getUniqueCharacterType(baseType: string): string {
  const existingTypes = new Set([
    ...Object.keys(POKEMON_DATA),
    ...getCustomCharactersConfig()
      .map((character) => character.type?.trim())
      .filter((type): type is string => Boolean(type)),
  ]);

  let candidate = slugifyCharacterType(baseType);
  let suffix = 2;

  while (existingTypes.has(candidate)) {
    candidate = `${slugifyCharacterType(baseType)}-${suffix}`;
    suffix++;
  }

  return candidate;
}

function isGifUri(uri: vscode.Uri): boolean {
  return path.extname(uri.fsPath).toLowerCase() === '.gif';
}

async function assertReadableGif(
  uri: vscode.Uri,
  label: string,
): Promise<void> {
  if (!isGifUri(uri)) {
    throw new Error(`${label} must be a .gif file.`);
  }

  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File) {
      throw new Error(`${label} must be a file.`);
    }
  } catch (error: any) {
    throw new Error(`Cannot read ${label}: ${error?.message ?? String(error)}`);
  }
}

async function pickGifFile(title: string): Promise<vscode.Uri | undefined> {
  const selected = await vscode.window.showOpenDialog({
    title,
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      gif: ['gif'],
    },
  });

  return selected?.[0];
}

async function copyCharacterGif(
  source: vscode.Uri,
  characterFolder: vscode.Uri,
  filename: string,
): Promise<vscode.Uri> {
  const target = vscode.Uri.joinPath(characterFolder, filename);
  await vscode.workspace.fs.copy(source, target, { overwrite: true });
  return target;
}

async function addCustomCharacterFromGifs(
  context: vscode.ExtensionContext,
): Promise<IUserCharacterConfig | undefined> {
  const idleGif = await pickGifFile('Select the idle GIF');
  if (!idleGif) {
    return undefined;
  }

  await assertReadableGif(idleGif, 'Idle GIF');

  const defaultName = path.basename(
    idleGif.fsPath,
    path.extname(idleGif.fsPath),
  );
  const name = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Name your companion'),
    placeHolder: vscode.l10n.t('For example: Hinata'),
    value: defaultName,
    validateInput: (value) =>
      value.trim() ? undefined : vscode.l10n.t('Name is required.'),
  });

  if (name === undefined) {
    return undefined;
  }

  const walkChoice = await vscode.window.showQuickPick(
    [
      {
        label: vscode.l10n.t('Use the same GIF for walking'),
        value: 'same',
      },
      {
        label: vscode.l10n.t('Select a separate walking GIF'),
        value: 'separate',
      },
    ],
    {
      placeHolder: vscode.l10n.t('Choose the walking animation'),
    },
  );

  if (!walkChoice) {
    return undefined;
  }

  const walkGif =
    walkChoice.value === 'same'
      ? idleGif
      : await pickGifFile('Select the walking GIF');

  if (!walkGif) {
    return undefined;
  }

  await assertReadableGif(walkGif, 'Walking GIF');

  const sizeInput = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Original sprite size in pixels'),
    placeHolder: '32',
    value: '32',
    validateInput: (value) => {
      const size = Number(value);
      return Number.isFinite(size) && size > 0
        ? undefined
        : vscode.l10n.t('Enter a positive number.');
    },
  });

  if (sizeInput === undefined) {
    return undefined;
  }

  const type = getUniqueCharacterType(name);
  const characterFolder = vscode.Uri.joinPath(
    context.globalStorageUri,
    CUSTOM_CHARACTER_STORAGE_FOLDER,
    type,
  );

  await vscode.workspace.fs.createDirectory(characterFolder);

  const savedIdleGif = await copyCharacterGif(
    idleGif,
    characterFolder,
    'idle.gif',
  );
  const savedWalkGif = await copyCharacterGif(
    walkGif,
    characterFolder,
    'walk.gif',
  );

  const characterConfig: IUserCharacterConfig = {
    type,
    name: name.trim(),
    idleGif: savedIdleGif.fsPath,
    walkGif: savedWalkGif.fsPath,
    originalSpriteSize: Number(sizeInput),
  };

  const customCharacters = getCustomCharactersConfig();
  await vscode.workspace
    .getConfiguration('vscode-anime-companions')
    .update(
      'customCharacters',
      [...customCharacters, characterConfig],
      vscode.ConfigurationTarget.Global,
    );

  return characterConfig;
}

function getBuiltInCharacters(): ICharacterDefinition[] {
  return Object.entries(POKEMON_DATA).map(([type, config]) => ({
    type: type as PokemonType,
    name: config.name,
    originalSpriteSize: config.originalSpriteSize || 32,
    isUserConfigured: false,
  }));
}

function getAvailableCharacters(): ICharacterDefinition[] {
  const characters = new Map<string, ICharacterDefinition>();

  for (const character of getBuiltInCharacters()) {
    characters.set(character.type, character);
  }

  for (const character of getConfiguredUserCharacters()) {
    characters.set(character.type, character);
  }

  return Array.from(characters.values());
}

function getCharacterDefinition(
  type: PokemonType,
): ICharacterDefinition | undefined {
  return getAvailableCharacters().find((character) => character.type === type);
}

function getDefaultCharacterType(): PokemonType {
  return getAvailableCharacters()[0]?.type ?? DEFAULT_POKEMON_TYPE;
}

function getRandomCharacter(): ICharacterDefinition {
  const characters = getAvailableCharacters();
  return characters[Math.floor(Math.random() * characters.length)];
}

function getResourceRoot(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.file(path.dirname(uri.fsPath));
}

function characterExists(type: PokemonType): boolean {
  return getCharacterDefinition(type) !== undefined;
}

function getConfiguredSize(): PokemonSize {
  var size = vscode.workspace
    .getConfiguration('vscode-anime-companions')
    .get<PokemonSize>('characterSize', DEFAULT_POKEMON_SCALE);
  if (ALL_SCALES.lastIndexOf(size) === -1) {
    size = DEFAULT_POKEMON_SCALE;
  }
  return size;
}

function getConfigurationPosition() {
  return vscode.workspace
    .getConfiguration('vscode-anime-companions')
    .get<ExtPosition>('position', DEFAULT_POSITION);
}

function getThrowWithMouseConfiguration(): boolean {
  return vscode.workspace
    .getConfiguration('vscode-anime-companions')
    .get<boolean>('throwBallWithMouse', true);
}

interface IDefaultPokemonConfig {
  type: PokemonType;
  name?: string;
}

function getConfiguredDefaultPokemon(): PokemonSpecification[] {
  const defaultConfig = vscode.workspace
    .getConfiguration('vscode-anime-companions')
    .get<IDefaultPokemonConfig[]>('defaultCharacters', []);

  const size = getConfiguredSize();
  const result: PokemonSpecification[] = [];

  for (const config of defaultConfig) {
    const character = getCharacterDefinition(config.type);
    if (character) {
      const name = config.name || character.name || randomName();
      const color = DEFAULT_COLOR;

      result.push(new PokemonSpecification(color, config.type, size, name));
    } else {
      console.warn(
        `Invalid character type in defaultCharacters config: ${config.type}`,
      );
    }
  }

  return result;
}

function getSessionPokemonCollection(
  context: vscode.ExtensionContext,
): PokemonSpecification[] {
  const savedCollection = PokemonSpecification.collectionFromMemento(
    context,
    getConfiguredSize(),
  );

  if (savedCollection.length > 0) {
    return savedCollection;
  }

  return getConfiguredDefaultPokemon();
}

function getDefaultPokemonForFreshSession(
  context: vscode.ExtensionContext,
): PokemonSpecification[] {
  const savedCollection = PokemonSpecification.collectionFromMemento(
    context,
    getConfiguredSize(),
  );

  if (savedCollection.length > 0) {
    return [];
  }

  return getConfiguredDefaultPokemon();
}

export function shouldSpawnInitialCollection(
  collection: PokemonSpecification[],
): boolean {
  return collection.length > 0;
}

async function spawnAndPersistCollection(
  context: vscode.ExtensionContext,
  panel: IPokemonPanel,
  collection: PokemonSpecification[],
): Promise<void> {
  collection.forEach((item) => {
    panel.spawnPokemon(item);
  });

  await storeCollectionAsMemento(context, collection);
}

function updatePanelThrowWithMouse(): void {
  const panel = getPokemonPanel();
  if (panel !== undefined) {
    panel.setThrowWithMouse(getThrowWithMouseConfiguration());
  }
}

async function updateExtensionPositionContext() {
  await vscode.commands.executeCommand(
    'setContext',
    'vscode-anime-companions.position',
    getConfigurationPosition(),
  );
}

export class PokemonSpecification {
  color: PokemonColor;
  type: PokemonType;
  size: PokemonSize;
  name: string;
  generation: string;
  originalSpriteSize: number;

  constructor(
    color: PokemonColor,
    type: PokemonType,
    size: PokemonSize,
    name?: string,
    generation?: string,
  ) {
    this.color = color;
    this.type = type;
    this.size = size;
    if (!name) {
      this.name = randomName();
    } else {
      this.name = name;
    }
    const character = getCharacterDefinition(type);
    this.generation =
      generation ||
      POKEMON_DATA[type]?.assetRoot ||
      (character?.isUserConfigured ? 'user' : 'custom');
    this.originalSpriteSize =
      character?.originalSpriteSize ||
      POKEMON_DATA[type]?.originalSpriteSize ||
      32;
  }

  static fromConfiguration(): PokemonSpecification {
    var color = vscode.workspace
      .getConfiguration('vscode-anime-companions')
      .get<PokemonColor>('characterColor', DEFAULT_COLOR);
    if (ALL_COLORS.lastIndexOf(color) === -1) {
      color = DEFAULT_COLOR;
    }
    var type = vscode.workspace
      .getConfiguration('vscode-anime-companions')
      .get<PokemonType>('characterType', getDefaultCharacterType());

    if (!characterExists(type)) {
      type = getDefaultCharacterType();
    }

    return new PokemonSpecification(color, type, getConfiguredSize());
  }

  static collectionFromMemento(
    context: vscode.ExtensionContext,
    size: PokemonSize,
  ): PokemonSpecification[] {
    var contextTypes = context.globalState.get<PokemonType[]>(
      EXTRA_POKEMON_KEY_TYPES,
      [],
    );
    var contextColors = context.globalState.get<PokemonColor[]>(
      EXTRA_POKEMON_KEY_COLORS,
      [],
    );
    var contextNames = context.globalState.get<string[]>(
      EXTRA_POKEMON_KEY_NAMES,
      [],
    );
    var result: PokemonSpecification[] = [];
    for (let index = 0; index < contextTypes.length; index++) {
      result.push(
        new PokemonSpecification(
          contextColors?.[index] ?? DEFAULT_COLOR,
          contextTypes[index],
          size,
          contextNames[index],
        ),
      );
    }
    return result;
  }
}

export async function storeCollectionAsMemento(
  context: vscode.ExtensionContext,
  collection: PokemonSpecification[],
) {
  var contextTypes = new Array(collection.length);
  var contextColors = new Array(collection.length);
  var contextNames = new Array(collection.length);
  for (let index = 0; index < collection.length; index++) {
    contextTypes[index] = collection[index].type;
    contextColors[index] = collection[index].color;
    contextNames[index] = collection[index].name;
  }
  await context.globalState.update(EXTRA_POKEMON_KEY_TYPES, contextTypes);
  await context.globalState.update(EXTRA_POKEMON_KEY_COLORS, contextColors);
  await context.globalState.update(EXTRA_POKEMON_KEY_NAMES, contextNames);
  context.globalState.setKeysForSync([
    EXTRA_POKEMON_KEY_TYPES,
    EXTRA_POKEMON_KEY_COLORS,
    EXTRA_POKEMON_KEY_NAMES,
  ]);
}

let spawnPokemonStatusBar: vscode.StatusBarItem;

interface IPokemonInfo {
  type: PokemonType;
  name: string;
  color: PokemonColor;
}

function waitForPokemonList(webview: vscode.Webview): Promise<IPokemonInfo[]> {
  return new Promise((resolve) => {
    const disposable = webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        if (message.command !== 'list-pokemon') {
          return;
        }
        disposable.dispose();
        const pokemonList: IPokemonInfo[] = [];
        message.text.split('\n').forEach((pokemon) => {
          if (!pokemon) {
            return;
          }
          var parts = pokemon.split(',');
          pokemonList.push({
            type: parts[0] as PokemonType,
            name: parts[1],
            color: parts[2] as PokemonColor,
          });
        });
        resolve(pokemonList);
      },
    );
  });
}

function getPokemonPanel(): IPokemonPanel | undefined {
  if (
    getConfigurationPosition() === ExtPosition.explorer &&
    webviewViewProvider
  ) {
    return webviewViewProvider;
  } else if (PokemonPanel.currentPanel) {
    return PokemonPanel.currentPanel;
  } else {
    return undefined;
  }
}

function getWebview(): vscode.Webview | undefined {
  if (
    getConfigurationPosition() === ExtPosition.explorer &&
    webviewViewProvider
  ) {
    return webviewViewProvider.getWebview();
  } else if (PokemonPanel.currentPanel) {
    return PokemonPanel.currentPanel.getWebview();
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.start',
      async () => {
        if (
          getConfigurationPosition() === ExtPosition.explorer &&
          webviewViewProvider
        ) {
          await vscode.commands.executeCommand('animeCompanionsView.focus');
        } else {
          const spec = PokemonSpecification.fromConfiguration();
          PokemonPanel.createOrShow(
            context.extensionUri,
            spec.color,
            spec.type,
            spec.size,
            spec.generation,
            spec.originalSpriteSize,
            getThrowWithMouseConfiguration(),
          );

          if (PokemonPanel.currentPanel) {
            const collection = getSessionPokemonCollection(context);
            await spawnAndPersistCollection(
              context,
              PokemonPanel.currentPanel,
              collection,
            );
          }
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.add-custom-character',
      async () => {
        try {
          const character = await addCustomCharacterFromGifs(context);
          if (!character) {
            return;
          }

          const spec = new PokemonSpecification(
            DEFAULT_COLOR,
            character.type as PokemonType,
            getConfiguredSize(),
            character.name,
          );

          if (
            getConfigurationPosition() === ExtPosition.explorer &&
            webviewViewProvider
          ) {
            await vscode.commands.executeCommand('animeCompanionsView.focus');
          }

          const panel = getPokemonPanel();

          if (panel) {
            panel.update();
            setTimeout(() => {
              panel.spawnPokemon(spec);
            }, 250);

            const collection = PokemonSpecification.collectionFromMemento(
              context,
              getConfiguredSize(),
            );
            collection.push(spec);
            await storeCollectionAsMemento(context, collection);
          }

          await vscode.window.showInformationMessage(
            vscode.l10n.t(
              'Added {0}. Use "Spawn additional character" to add it again.',
              character.name || character.type,
            ),
          );
        } catch (error: any) {
          await vscode.window.showErrorMessage(
            vscode.l10n.t(
              'Failed to add custom companion: {0}',
              error?.message ?? String(error),
            ),
          );
        }
      },
    ),
  );

  spawnPokemonStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  spawnPokemonStatusBar.command = 'vscode-anime-companions.spawn-character';
  context.subscriptions.push(spawnPokemonStatusBar);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(updateStatusBar),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateExtensionPositionContext),
  );
  updateStatusBar();

  const spec = PokemonSpecification.fromConfiguration();
  webviewViewProvider = new PokemonWebviewViewProvider(
    context,
    context.extensionUri,
    spec.color,
    spec.type,
    spec.size,
    spec.generation,
    spec.originalSpriteSize,
    getThrowWithMouseConfiguration(),
  );
  updateExtensionPositionContext().catch((e) => {
    console.error(e);
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PokemonWebviewViewProvider.viewType,
      webviewViewProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.delete-character',
      async () => {
        const panel = getPokemonPanel();
        if (panel === undefined) {
          await createPokemonPlayground(context);
          return;
        }
        const webview = getWebview();
        if (!webview) {
          return;
        }
        const listPromise = waitForPokemonList(webview);
        panel.listPokemon();
        const pokemonList = await listPromise;

        if (!pokemonList.length) {
          await vscode.window.showErrorMessage(
            vscode.l10n.t('There are no characters to remove.'),
          );
          return;
        }
        const pokemon = await vscode.window.showQuickPick<PokemonQuickPickItem>(
          pokemonList.map((val) => {
            return new PokemonQuickPickItem(val.name, val.type, val.color);
          }),
          {
            placeHolder: vscode.l10n.t('Select the character to remove.'),
          },
        );
        if (pokemon) {
          panel.deletePokemon(pokemon.name);
          const collection = pokemonList
            .filter((item) => {
              return item.name !== pokemon.name;
            })
            .map<PokemonSpecification>((item) => {
              return new PokemonSpecification(
                item.color,
                item.type,
                PokemonSize.medium,
                item.name,
              );
            });
          await storeCollectionAsMemento(context, collection);
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.remove-all-characters',
      async () => {
        const panel = getPokemonPanel();
        if (panel !== undefined) {
          panel.resetPokemon();
          await storeCollectionAsMemento(context, []);
        } else {
          await createPokemonPlayground(context);
          await vscode.window.showInformationMessage(
            vscode.l10n.t(
              "An Anime Companions panel has been created. You can now use the 'Remove All Characters' command to remove all characters.",
            ),
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.roll-call',
      async () => {
        const panel = getPokemonPanel();
        if (panel !== undefined) {
          panel.rollCall();
        } else {
          await createPokemonPlayground(context);
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.configure-keybindings',
      async () => {
        const items: Array<vscode.QuickPickItem & { commandId: string }> = [
          {
            label: vscode.l10n.t('Spawn additional character'),
            description: 'vscode-anime-companions.spawn-character',
            commandId: 'vscode-anime-companions.spawn-character',
          },
          {
            label: vscode.l10n.t('Spawn random character'),
            description: 'vscode-anime-companions.spawn-random-character',
            commandId: 'vscode-anime-companions.spawn-random-character',
          },
          {
            label: vscode.l10n.t('Remove character'),
            description: 'vscode-anime-companions.delete-character',
            commandId: 'vscode-anime-companions.delete-character',
          },
          {
            label: vscode.l10n.t('Remove all characters'),
            description: 'vscode-anime-companions.remove-all-characters',
            commandId: 'vscode-anime-companions.remove-all-characters',
          },
        ];

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: vscode.l10n.t(
            'Select a command to configure its keybinding',
          ),
          matchOnDescription: true,
        });
        if (!picked) {
          return;
        }
        await vscode.commands.executeCommand(
          'workbench.action.openGlobalKeybindings',
          picked.commandId,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.export-character-list',
      async () => {
        const pokemonCollection = PokemonSpecification.collectionFromMemento(
          context,
          getConfiguredSize(),
        );
        const pokemonJson = JSON.stringify(pokemonCollection, null, 2);
        const fileName = `characterCollection-${Date.now()}.json`;
        if (!vscode.workspace.workspaceFolders) {
          await vscode.window.showErrorMessage(
            vscode.l10n.t(
              'You must have a folder or workspace open to export characterCollection.',
            ),
          );
          return;
        }
        const filePath = vscode.Uri.joinPath(
          vscode.workspace.workspaceFolders[0].uri,
          fileName,
        );
        const newUri = vscode.Uri.file(fileName).with({
          scheme: 'untitled',
          path: filePath.fsPath,
        });
        await vscode.workspace.openTextDocument(newUri).then(async (doc) => {
          await vscode.window.showTextDocument(doc).then(async (editor) => {
            await editor.edit((edit) => {
              edit.insert(new vscode.Position(0, 0), pokemonJson);
            });
          });
        });
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.import-character-list',
      async () => {
        const options: vscode.OpenDialogOptions = {
          canSelectMany: false,
          openLabel: 'Open characterCollection.json',
          filters: {
            json: ['json'],
          },
        };
        const fileUri = await vscode.window.showOpenDialog(options);

        if (fileUri && fileUri[0]) {
          console.log('Selected file: ' + fileUri[0].fsPath);
          try {
            const fileContents = await vscode.workspace.fs.readFile(fileUri[0]);
            const pokemonToLoad = JSON.parse(
              String.fromCharCode.apply(null, Array.from(fileContents)),
            );

            // Load the characters into the collection.
            var collection = PokemonSpecification.collectionFromMemento(
              context,
              getConfiguredSize(),
            );
            // Fetch just the character types.
            const panel = getPokemonPanel();
            for (let i = 0; i < pokemonToLoad.length; i++) {
              const pokemon = pokemonToLoad[i];
              const pokemonSpec = new PokemonSpecification(
                normalizeColor(pokemon.color, pokemon.type),
                pokemon.type,
                pokemon.size,
                pokemon.name,
              );
              collection.push(pokemonSpec);
              if (panel !== undefined) {
                panel.spawnPokemon(pokemonSpec);
              }
            }
            await storeCollectionAsMemento(context, collection);
          } catch (e: any) {
            await vscode.window.showErrorMessage(
              vscode.l10n.t('Failed to import characters: {0}', e?.message),
            );
          }
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.spawn-character',
      async () => {
        const panel = getPokemonPanel();
        if (
          getConfigurationPosition() === ExtPosition.explorer &&
          webviewViewProvider
        ) {
          await vscode.commands.executeCommand('animeCompanionsView.focus');
        }
        if (panel) {
          const characterOptions: Array<
            vscode.QuickPickItem & { value: PokemonType }
          > = getAvailableCharacters().map((character) => ({
            label: character.name,
            value: character.type,
            description: character.isUserConfigured
              ? vscode.l10n.t('Configured in settings')
              : vscode.l10n.t('Included character'),
            detail: character.type,
          }));

          const selectedCharacter = await vscode.window.showQuickPick(
            characterOptions,
            {
              placeHolder: vscode.l10n.t('Select a character'),
              matchOnDescription: true,
              matchOnDetail: true,
            },
          );

          if (!selectedCharacter) {
            console.log('Cancelled spawning character - no selection');
            return;
          }

          const possibleColors = availableColors(selectedCharacter.value);

          const name = await vscode.window.showInputBox({
            placeHolder: vscode.l10n.t('Leave blank for a random name'),
            prompt: vscode.l10n.t('Name your character'),
            value: randomName(),
          });

          if (name === undefined) {
            console.log('Cancelled spawning character - no name entered');
            return;
          }

          const spec = new PokemonSpecification(
            possibleColors[0] ?? DEFAULT_COLOR,
            selectedCharacter.value,
            getConfiguredSize(),
            name,
          );

          panel.spawnPokemon(spec);
          var collection = PokemonSpecification.collectionFromMemento(
            context,
            getConfiguredSize(),
          );
          collection.push(spec);
          await storeCollectionAsMemento(context, collection);
        } else {
          await createPokemonPlayground(context);
          await vscode.window.showInformationMessage(
            vscode.l10n.t(
              "An Anime Companions panel has been created. You can now use the 'Spawn Additional Character' command to add more characters.",
            ),
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-anime-companions.spawn-random-character',
      async () => {
        const panel = getPokemonPanel();
        if (
          getConfigurationPosition() === ExtPosition.explorer &&
          webviewViewProvider
        ) {
          await vscode.commands.executeCommand('animeCompanionsView.focus');
        }
        if (panel) {
          const randomCharacter = getRandomCharacter();
          const spec = new PokemonSpecification(
            DEFAULT_COLOR,
            randomCharacter.type,
            getConfiguredSize(),
            randomCharacter.name,
          );

          panel.spawnPokemon(spec);
          var collection = PokemonSpecification.collectionFromMemento(
            context,
            getConfiguredSize(),
          );
          collection.push(spec);
          await storeCollectionAsMemento(context, collection);
        } else {
          await createPokemonPlayground(context);
          await vscode.window.showInformationMessage(
            vscode.l10n.t(
              "An Anime Companions panel has been created. You can now use the 'Remove All Characters' command to remove all characters.",
            ),
          );
        }
      },
    ),
  );

  // Listening to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(
      (e: vscode.ConfigurationChangeEvent): void => {
        if (
          e.affectsConfiguration('vscode-anime-companions.characterColor') ||
          e.affectsConfiguration('vscode-anime-companions.characterType') ||
          e.affectsConfiguration('vscode-anime-companions.characterSize') ||
          e.affectsConfiguration('vscode-anime-companions.defaultCharacters') ||
          e.affectsConfiguration('vscode-anime-companions.customCharacters')
        ) {
          const spec = PokemonSpecification.fromConfiguration();
          const panel = getPokemonPanel();
          if (panel) {
            panel.updatePokemonColor(spec.color);
            panel.updatePokemonSize(spec.size);
            panel.updatePokemonType(spec.type);
            panel.update();
          }
        }

        if (e.affectsConfiguration('vscode-anime-companions.position')) {
          void updateExtensionPositionContext();
        }

        if (
          e.affectsConfiguration('vscode-anime-companions.throwBallWithMouse')
        ) {
          updatePanelThrowWithMouse();
        }
      },
    ),
  );

  if (vscode.window.registerWebviewPanelSerializer) {
    // Make sure we register a serializer in activation event
    vscode.window.registerWebviewPanelSerializer(PokemonPanel.viewType, {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
        // Reset the webview options so we use latest uri for `localResourceRoots`.
        webviewPanel.webview.options = getWebviewOptions(context.extensionUri);
        const spec = PokemonSpecification.fromConfiguration();
        PokemonPanel.revive(
          webviewPanel,
          context.extensionUri,
          spec.color,
          spec.type,
          spec.size,
          spec.generation,
          spec.originalSpriteSize,
          getThrowWithMouseConfiguration(),
        );

        if (PokemonPanel.currentPanel) {
          const collection = getDefaultPokemonForFreshSession(context);
          if (shouldSpawnInitialCollection(collection)) {
            await spawnAndPersistCollection(
              context,
              PokemonPanel.currentPanel,
              collection,
            );
          }
        }
      },
    });
  }
}

function updateStatusBar(): void {
  spawnPokemonStatusBar.text = `$(squirrel)`;
  spawnPokemonStatusBar.tooltip = vscode.l10n.t('Spawn character');
  spawnPokemonStatusBar.show();
}

export function spawnPokemonDeactivate() {
  spawnPokemonStatusBar.dispose();
}

function getWebviewOptions(
  extensionUri: vscode.Uri,
): vscode.WebviewOptions & vscode.WebviewPanelOptions {
  const userGifRoots = getConfiguredUserCharacters()
    .flatMap((character) =>
      [
        character.idleGif,
        character.walkGif,
        ...Object.values(character.animationGifs ?? {}),
      ].filter((uri): uri is vscode.Uri => uri !== undefined),
    )
    .map(getResourceRoot);

  return {
    // Enable javascript in the webview
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, 'media'),
      ...userGifRoots,
    ],
  };
}

interface IPokemonPanel {
  // throwBall(): void;
  resetPokemon(): void;
  spawnPokemon(spec: PokemonSpecification): void;
  deletePokemon(pokemonName: string): void;
  listPokemon(): void;
  rollCall(): void;
  throwBallWithMouse(): boolean;
  updatePokemonColor(newColor: PokemonColor): void;
  updatePokemonType(newType: PokemonType): void;
  updatePokemonSize(newSize: PokemonSize): void;
  update(): void;
  setThrowWithMouse(newThrowWithMouse: boolean): void;
}

class PokemonWebviewContainer implements IPokemonPanel {
  protected _extensionUri: vscode.Uri;
  protected _disposables: vscode.Disposable[] = [];
  protected _characterColor: PokemonColor;
  protected _characterType: PokemonType;
  protected _characterSize: PokemonSize;
  protected _pokemonGeneration: string;
  protected _pokemonOriginalSpriteSize: number;
  protected _throwBallWithMouse: boolean;

  constructor(
    extensionUri: vscode.Uri,
    color: PokemonColor,
    type: PokemonType,
    size: PokemonSize,
    generation: string,
    originalSpriteSize: number,
    throwBallWithMouse: boolean,
  ) {
    this._extensionUri = extensionUri;
    this._characterColor = color;
    this._characterType = type;
    this._characterSize = size;
    this._pokemonGeneration = generation;
    this._pokemonOriginalSpriteSize = originalSpriteSize;
    this._throwBallWithMouse = throwBallWithMouse;
  }

  public characterColor(): PokemonColor {
    return normalizeColor(this._characterColor, this._characterType);
  }

  public characterType(): PokemonType {
    return this._characterType;
  }

  public characterSize(): PokemonSize {
    return this._characterSize;
  }

  public pokemonGeneration(): string {
    return this._pokemonGeneration;
  }

  public pokemonOriginalSpriteSize(): number {
    return this._pokemonOriginalSpriteSize;
  }

  public throwBallWithMouse(): boolean {
    return this._throwBallWithMouse;
  }

  public updatePokemonColor(newColor: PokemonColor) {
    this._characterColor = newColor;
  }

  public updatePokemonType(newType: PokemonType) {
    this._characterType = newType;
  }

  public updatePokemonSize(newSize: PokemonSize) {
    this._characterSize = newSize;
  }

  public updatePokemonGeneration(newGeneration: string) {
    this._pokemonGeneration = newGeneration;
  }

  public setThrowWithMouse(newThrowWithMouse: boolean): void {
    this._throwBallWithMouse = newThrowWithMouse;
    void this.getWebview().postMessage({
      command: 'throw-with-mouse',
      enabled: newThrowWithMouse,
    });
  }

  public throwBall() {
    void this.getWebview().postMessage({
      command: 'throw-ball',
    });
  }

  public resetPokemon(): void {
    void this.getWebview().postMessage({
      command: 'reset-pokemon',
    });
  }

  public spawnPokemon(spec: PokemonSpecification) {
    void this.getWebview().postMessage({
      command: 'spawn-character',
      type: spec.type,
      color: spec.color,
      name: spec.name,
      generation: spec.generation,
      originalSpriteSize: spec.originalSpriteSize,
    });
    void this.getWebview().postMessage({
      command: 'set-size',
      size: spec.size,
    });
  }

  public listPokemon() {
    void this.getWebview().postMessage({ command: 'list-pokemon' });
  }

  public rollCall(): void {
    void this.getWebview().postMessage({ command: 'roll-call' });
  }

  public deletePokemon(pokemonName: string) {
    void this.getWebview().postMessage({
      command: 'delete-character',
      name: pokemonName,
    });
  }

  protected getWebview(): vscode.Webview {
    throw new Error('Not implemented');
  }

  protected _update() {
    const webview = this.getWebview();
    webview.options = getWebviewOptions(this._extensionUri);
    webview.html = this._getHtmlForWebview(webview);
  }

  // #TODO: verify if this is needed
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public update() {}

  protected _getHtmlForWebview(webview: vscode.Webview) {
    // Local path to main script run in the webview
    const scriptPathOnDisk = vscode.Uri.joinPath(
      this._extensionUri,
      'media',
      'main-bundle.js',
    );

    // And the uri we use to load this script in the webview
    const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

    // Local path to css styles
    const styleResetPath = vscode.Uri.joinPath(
      this._extensionUri,
      'media',
      'reset.css',
    );
    const stylesPathMainPath = vscode.Uri.joinPath(
      this._extensionUri,
      'media',
      'pokemon.css',
    );
    const silkScreenFontPath = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'media',
        'Silkscreen-Regular.ttf',
      ),
    );

    // Uri to load styles into webview
    const stylesResetUri = webview.asWebviewUri(styleResetPath);
    const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

    // Get path to resource on disk
    const basePokemonUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media'),
    );
    const userCharacterAssets =
      getConfiguredUserCharacters().reduce<IWebviewCharacterAssets>(
        (assets, character) => {
          if (character.idleGif && character.walkGif) {
            assets[character.type] = {
              idle: webview.asWebviewUri(character.idleGif).toString(),
              walk: webview.asWebviewUri(character.walkGif).toString(),
            };

            for (const [animationLabel, gifUri] of Object.entries(
              character.animationGifs ?? {},
            )) {
              assets[character.type][animationLabel] = webview
                .asWebviewUri(gifUri)
                .toString();
            }
          }
          return assets;
        },
        {},
      );

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
          webview.cspSource
        } 'nonce-${nonce}'; img-src ${
          webview.cspSource
        } https:; script-src 'nonce-${nonce}';
                font-src ${webview.cspSource};">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${stylesResetUri}" rel="stylesheet" nonce="${nonce}">
				<link href="${stylesMainUri}" rel="stylesheet" nonce="${nonce}">
                <style nonce="${nonce}">
                @font-face {
                    font-family: 'silkscreen';
                    src: url('${silkScreenFontPath}') format('truetype');
                }
                </style>
				<title>VS Code Anime Companions</title>
			</head>
			<body>
                <canvas id="pokemonCanvas"></canvas>
                <div id="pokemonContainer"></div>
                <div id="foreground"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
                <script nonce="${nonce}">
                    pokemonApp.pokemonPanelApp(
                        "${basePokemonUri}",
                        "${this.characterColor()}",
                        "${this.characterSize()}",
                        "${this.characterType()}",
                        "${this.throwBallWithMouse()}",
                        "${this.pokemonGeneration()}",
                        "${this.pokemonOriginalSpriteSize()}",
                        ${JSON.stringify(userCharacterAssets)},
                    );
                </script>
            </body>
			</html>`;
  }
}

function handleWebviewMessage(message: WebviewMessage) {
  switch (message.command) {
    case 'alert':
      void vscode.window.showErrorMessage(message.text);
      return;
    case 'info':
      void vscode.window.showInformationMessage(message.text);
      return;
  }
}

/**
 * Manages pokemon coding webview panels
 */
class PokemonPanel extends PokemonWebviewContainer implements IPokemonPanel {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: PokemonPanel | undefined;

  public static readonly viewType = 'animeCompanionsCoding';

  private readonly _panel: vscode.WebviewPanel;

  public static createOrShow(
    extensionUri: vscode.Uri,
    characterColor: PokemonColor,
    characterType: PokemonType,
    characterSize: PokemonSize,
    pokemonGeneration: string,
    pokemonOriginalSpriteSize: number,
    throwBallWithMouse: boolean,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
    // If we already have a panel, show it.
    if (PokemonPanel.currentPanel) {
      if (
        characterColor === PokemonPanel.currentPanel.characterColor() &&
        characterType === PokemonPanel.currentPanel.characterType() &&
        characterSize === PokemonPanel.currentPanel.characterSize() &&
        pokemonGeneration === PokemonPanel.currentPanel.pokemonGeneration()
      ) {
        PokemonPanel.currentPanel._panel.reveal(column);
        return;
      } else {
        PokemonPanel.currentPanel.updatePokemonColor(characterColor);
        PokemonPanel.currentPanel.updatePokemonType(characterType);
        PokemonPanel.currentPanel.updatePokemonSize(characterSize);
        PokemonPanel.currentPanel.update();
      }
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      PokemonPanel.viewType,
      vscode.l10n.t('Anime Companions Panel'),
      vscode.ViewColumn.Two,
      getWebviewOptions(extensionUri),
    );

    PokemonPanel.currentPanel = new PokemonPanel(
      panel,
      extensionUri,
      characterColor,
      characterType,
      characterSize,
      pokemonGeneration,
      pokemonOriginalSpriteSize,
      throwBallWithMouse,
    );
  }

  public resetPokemon() {
    void this.getWebview().postMessage({ command: 'reset-pokemon' });
  }

  public listPokemon() {
    void this.getWebview().postMessage({ command: 'list-pokemon' });
  }

  public rollCall(): void {
    void this.getWebview().postMessage({ command: 'roll-call' });
  }

  public deletePokemon(pokemonName: string): void {
    void this.getWebview().postMessage({
      command: 'delete-character',
      name: pokemonName,
    });
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    characterColor: PokemonColor,
    characterType: PokemonType,
    characterSize: PokemonSize,
    pokemonGeneration: string,
    pokemonOriginalSpriteSize: number,
    throwBallWithMouse: boolean,
  ) {
    PokemonPanel.currentPanel = new PokemonPanel(
      panel,
      extensionUri,
      characterColor,
      characterType,
      characterSize,
      pokemonGeneration,
      pokemonOriginalSpriteSize,
      throwBallWithMouse,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    color: PokemonColor,
    type: PokemonType,
    size: PokemonSize,
    generation: string,
    originalSpriteSize: number,
    throwBallWithMouse: boolean,
  ) {
    super(
      extensionUri,
      color,
      type,
      size,
      generation,
      originalSpriteSize,
      throwBallWithMouse,
    );

    this._panel = panel;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Update the content based on view changes
    this._panel.onDidChangeViewState(
      () => {
        this.update();
      },
      null,
      this._disposables,
    );

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      handleWebviewMessage,
      null,
      this._disposables,
    );
  }

  public dispose() {
    PokemonPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  public update() {
    if (this._panel.visible) {
      this._update();
    }
  }

  getWebview(): vscode.Webview {
    return this._panel.webview;
  }
}

class PokemonWebviewViewProvider extends PokemonWebviewContainer {
  public static readonly viewType = 'animeCompanionsView';

  private _webviewView?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;

  constructor(
    context: vscode.ExtensionContext,
    extensionUri: vscode.Uri,
    color: PokemonColor,
    type: PokemonType,
    size: PokemonSize,
    generation: string,
    originalSpriteSize: number,
    throwBallWithMouse: boolean,
  ) {
    super(
      extensionUri,
      color,
      type,
      size,
      generation,
      originalSpriteSize,
      throwBallWithMouse,
    );
    this._context = context;
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this._webviewView = webviewView;

    webviewView.webview.options = getWebviewOptions(this._extensionUri);
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      handleWebviewMessage,
      null,
      this._disposables,
    );

    const collection = getDefaultPokemonForFreshSession(this._context);
    if (shouldSpawnInitialCollection(collection)) {
      await spawnAndPersistCollection(this._context, this, collection);
    }
  }

  update() {
    this._update();
  }

  getWebview(): vscode.Webview {
    if (this._webviewView === undefined) {
      throw new Error(
        vscode.l10n.t(
          'Panel not active, make sure the Anime Companions view is visible before running this command.',
        ),
      );
    } else {
      return this._webviewView.webview;
    }
  }
}

function getNonce() {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function createPokemonPlayground(context: vscode.ExtensionContext) {
  const spec = PokemonSpecification.fromConfiguration();
  PokemonPanel.createOrShow(
    context.extensionUri,
    spec.color,
    spec.type,
    spec.size,
    spec.generation,
    spec.originalSpriteSize,
    getThrowWithMouseConfiguration(),
  );
  if (PokemonPanel.currentPanel) {
    var collection = PokemonSpecification.collectionFromMemento(
      context,
      getConfiguredSize(),
    );
    collection.forEach((item) => {
      PokemonPanel.currentPanel?.spawnPokemon(item);
    });
    await storeCollectionAsMemento(context, collection);
  } else {
    var collection = PokemonSpecification.collectionFromMemento(
      context,
      getConfiguredSize(),
    );
    collection.push(spec);
    await storeCollectionAsMemento(context, collection);
  }
}
