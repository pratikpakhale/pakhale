export interface FileArtifact {
  kind: 'file'
  src: string
  dest: string
  mode?: number
}

export interface SymlinkArtifact {
  kind: 'symlink'
  target: string
  linkPath: string
  /** Where to move a displaced real directory; absent → warn and leave it alone. */
  archiveDisplaced?: string
}

export interface JsonMergeArtifact {
  kind: 'jsonMerge'
  dest: string
  managed: Record<string, unknown>
  derived: Record<string, unknown>
}

/**
 * How to tell an installer's work is already done. Declared as data so a plan stays
 * inert — the executor is the only thing that touches the machine.
 */
export type InstallProbe =
  | { kind: 'claude-plugin'; id: string }
  | { kind: 'claude-marketplace'; name: string; registryFile: string }
  /**
   * `names` empty means "whatever the repo exposes today", which no local file can confirm —
   * the lockfile records what was installed, not what upstream now has. Such a delivery is
   * never satisfied, so the installer re-runs every time and picks up upstream's additions.
   */
  | { kind: 'skills'; lockFile: string; names: string[]; linkDir?: string }

/** Something an external installer owns. Probed like every other artifact, so it converges. */
export interface InstallArtifact {
  kind: 'install'
  label: string
  /** Binary that must be on PATH; missing it blocks the artifact instead of failing the run. */
  requires: string
  command: string[]
  probe: InstallProbe
}

export type Artifact = FileArtifact | SymlinkArtifact | JsonMergeArtifact | InstallArtifact

export interface ArtifactGroup {
  section: string
  artifacts: Artifact[]
}

export interface Plan {
  archiveDir: string
  groups: ArtifactGroup[]
}
