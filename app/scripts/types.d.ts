// mapshaper ships no type declarations.
declare module 'mapshaper' {
  const mapshaper: {
    applyCommands(commands: string, input?: Record<string, string | Buffer>): Promise<Record<string, Buffer | string>>;
  };
  export default mapshaper;
}

// fontkit 3 ships no type declarations either: only what scripts/font-metrics.mjs uses.
declare module 'fontkit' {
  export interface Glyph {
    advanceWidth: number;
  }
  export interface Font {
    unitsPerEm: number;
    hasGlyphForCodePoint(codePoint: number): boolean;
    glyphForCodePoint(codePoint: number): Glyph;
  }
  export function openSync(filename: string): Font;
}
