/** Render an Electron accelerator for humans: `CommandOrControl+Alt+Shift+F` -> `Ctrl/Cmd+Alt+Shift+F`. */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => {
      switch (part.toLowerCase()) {
        case 'commandorcontrol':
        case 'cmdorctrl':
          return 'Ctrl/Cmd';
        case 'command':
        case 'cmd':
          return 'Cmd';
        case 'control':
        case 'ctrl':
          return 'Ctrl';
        case 'option':
          return 'Alt';
        default:
          return part.length === 1 ? part.toUpperCase() : part;
      }
    })
    .join('+');
}
