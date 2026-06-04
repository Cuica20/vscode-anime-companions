# VS Code Anime Companions

Minimal VS Code extension for showing animated GIF companions in the editor.

## Configure Your Own GIFs

Users do not need to edit the source code to add companions.

The easiest flow is:

1. Open the command palette.
2. Run `Anime Companions: Add custom companion from GIFs`.
3. Select an idle GIF.
4. Reuse that GIF for walking, or select a separate walking GIF.
5. Give the companion a name and original sprite size.

The extension copies those GIFs into its own VS Code storage folder and adds the companion to `vscode-anime-companions.customCharacters` automatically.

You can also add GIF paths manually in VS Code settings:

```json
{
  "vscode-anime-companions.customCharacters": [
    {
      "type": "digimon-gif",
      "name": "Digimon GIF",
      "idleGif": "C:/Users/javierCuicapuza/vscode-anime-companions/media/custom/animes2/digimon GIF.gif",
      "walkGif": "C:/Users/javierCuicapuza/vscode-anime-companions/media/custom/animes2/digimon GIF.gif",
      "originalSpriteSize": 50
    },
    {
      "type": "fullmetal-alchemist-4",
      "name": "Fullmetal Alchemist 4",
      "idleGif": "C:/Users/javierCuicapuza/vscode-anime-companions/media/custom/animes2/fullmetal_alchemist_4.gif",
      "walkGif": "C:/Users/javierCuicapuza/vscode-anime-companions/media/custom/animes2/fullmetal_alchemist_4.gif",
      "originalSpriteSize": 50
    },
    {
      "type": "rurouni-kenshin-6",
      "name": "Rurouni Kenshin 6",
      "idleGif": "C:/Users/javierCuicapuza/vscode-anime-companions/media/custom/animes2/rurouni_kenshin_6.gif",
      "walkGif": "C:/Users/javierCuicapuza/vscode-anime-companions/media/custom/animes2/rurouni_kenshin_6.gif",
      "originalSpriteSize": 50
    }
  ],
  "vscode-anime-companions.defaultCharacters": [
    { "type": "digimon-gif", "name": "Digimon GIF" },
    { "type": "fullmetal-alchemist-4", "name": "Fullmetal Alchemist 4" },
    { "type": "rurouni-kenshin-6", "name": "Rurouni Kenshin 6" }
  ],
  "vscode-anime-companions.characterSize": "medium",
  "vscode-anime-companions.position": "explorer",
  "vscode-anime-companions.animationTickMs": 33,
  "vscode-anime-companions.stateDurationMultiplier": 2,
  "vscode-anime-companions.imageRendering": "auto"
}
```

The example above uses Windows absolute paths from the `C:` drive and spawns three companions at the same time in the Explorer view. Forward slashes are recommended in JSON because they avoid escaping backslashes.

For high-resolution or longer GIFs, these settings help the movement feel smoother:

- `animationTickMs`: lower values update movement more often. `33` is close to 30 updates per second.
- `stateDurationMultiplier`: higher values keep each behavior active longer, so longer GIFs have more time to play.
- `imageRendering`: use `auto` for high-resolution GIFs and `pixelated` for pixel art.

`idleGif`, `walkGif`, and `animationGifs` values can be absolute paths, `~/` paths, or paths relative to the open workspace folder.

Path examples:

```json
{
  "windows": "C:/Users/richa/Pictures/anime/hinata_idle.gif",
  "macOS": "/Users/richa/Pictures/anime/hinata_idle.gif",
  "linux": "/home/richa/Pictures/anime/hinata_idle.gif",
  "homeFolder": "~/Pictures/anime/hinata_idle.gif",
  "workspaceRelative": "gifs/hinata_idle.gif"
}
```

This extension can run on Windows, macOS, and Linux as long as the configured GIF paths exist on that machine. If you share a settings file across operating systems, prefer `~/...` paths or workspace-relative paths instead of `C:/...`, because `C:/...` only works on Windows.

To add more companions, add more objects to `vscode-anime-companions.customCharacters`. Each object needs a unique `type`.

Each companion needs two base animation GIFs:

- `idleGif`: standing or waiting animation.
- `walkGif`: walking animation.

You can add more GIFs with `animationGifs`. The keys are animation labels used by the panel:

```json
"animationGifs": {
  "swipe": "gifs/hinata_swipe.gif",
  "walk_left": "gifs/hinata_walk_left.gif",
  "with_ball": "gifs/hinata_with_ball.gif"
}
```

Common labels:

- `swipe`: plays when you hover the mouse over the companion.
- `walk_left`: optional separate animation for walking left.
- `with_ball`, `lie`, `wallgrab`, `land`, `run`, `stand`: supported by the animation resolver when the panel enters those states.

If an extra GIF is missing, the extension falls back to `walkGif` for walking states and `idleGif` for everything else.

Each custom character needs:

- `type`: unique id, for example `hinata`.
- `name`: display name in the picker.
- `idleGif`: GIF used when the character is standing.
- `walkGif`: GIF used while the character walks.
- `animationGifs`: optional extra GIFs by animation label.
- `originalSpriteSize`: original pixel size before scaling, usually `32`.

Other users can install the extension and configure their own GIF paths through Settings.

For public redistribution, only bundle GIFs you own or have permission to distribute. For most use cases, prefer user-configured GIF paths instead of shipping copyrighted artwork inside the extension.

## Build And Install

```bash
npm install
npm run compile
npx @vscode/vsce package
code --install-extension vscode-anime-companions-0.1.1.vsix
```

Use copyrighted character artwork only where you have the rights or for personal local use.
