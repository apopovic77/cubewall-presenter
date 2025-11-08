declare module '@babylonjs/havok' {
  export interface HavokInitOptions {
    locateFile?: (path: string) => string;
  }
  export default function HavokPhysics(options?: HavokInitOptions): Promise<any>;
}
