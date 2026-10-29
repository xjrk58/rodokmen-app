// mapshaper ships no type declarations.
declare module 'mapshaper' {
  const mapshaper: {
    applyCommands(commands: string, input?: Record<string, string | Buffer>): Promise<Record<string, Buffer | string>>;
  };
  export default mapshaper;
}
