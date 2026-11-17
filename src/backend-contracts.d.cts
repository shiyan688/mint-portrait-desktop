/** Unwired contract scaffold. No model, automatic fallback, or quality/SOTA claim. */
export type Task = 'retouch' | 'matting' | 'inpaint' | 'restore';
export type ModelKind = 'model' | 'test-double';
export type ModelStatus = 'ready' | 'missing' | 'incompatible' | 'disabled';
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'superseded';
export type ErrorCode = 'INVALID_INPUT' | 'UNSUPPORTED_TASK' | 'MODEL_MISSING' | 'MODEL_UNAVAILABLE' |
  'INCOMPATIBLE_TASK' | 'LICENSE_NOT_APPROVED' | 'TEST_DOUBLE_DISABLED' | 'SESSION_CLOSED' |
  'CANCELLED' | 'STALE_JOB' | 'INVALID_PROVENANCE' | 'INVALID_OUTPUT' | 'INFERENCE_FAILED';

export interface Image {
  readonly width: number;
  readonly height: number;
  readonly format: 'rgba8';
  readonly alphaMode: 'straight';
  readonly colorSpace: 'srgb';
  /** Caller-owned or copied bytes, never the runner's private original. Shared buffers are rejected. */
  readonly data: Uint8Array | Uint8ClampedArray;
}
export interface OriginalROI {
  /** Integer coordinates and dimensions in original-image pixels, never preview/model coordinates. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface Mask {
  readonly width: number;
  readonly height: number;
  readonly space: 'roi-original-pixels';
  readonly encoding: 'unit-float32';
  /** One finite [0,1] value per ROI pixel. No inferred byte scale or implicit resampling. */
  readonly data: Float32Array;
}
export interface Device {
  readonly kind: 'cpu' | 'cuda' | 'directml' | 'metal';
  readonly name: string;
}
export interface ModelDescriptor {
  readonly id: string;
  readonly version: string;
  /** Lowercase SHA-256 of the pinned weights bundle; test doubles may use test-double:no-weights. */
  readonly weightsSha256: string;
  readonly kind: ModelKind;
  readonly tasks: readonly Task[];
  readonly device: Device;
  readonly license: Readonly<{ id: string; url: string; status: 'approved' | 'pending' | 'blocked' }>;
  readonly status: ModelStatus;
}
export interface Provenance<T extends Task = Task> {
  readonly jobId: string;
  readonly task: T;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly weightsSha256: string;
  readonly kind: ModelKind;
  readonly device: Device;
  /** Present only for a separately declared matting foreground-color plane. */
  readonly foregroundRefinement?: ForegroundRefinement;
  /** Whether the immutable compositor explicitly applied that plane. */
  readonly foregroundApplied?: boolean;
  readonly foregroundStrength?: number;
}
export interface ForegroundRefinement {
  readonly kind: 'classical-color-estimation';
  readonly implementation: 'pymatting';
  readonly version: '1.1.16';
  readonly method: 'estimate_foreground_ml';
  /** Lowercase SHA-256 of the exact ROI float32 little-endian matte used for estimation. */
  readonly alphaDigest: string;
  /** Lowercase SHA-256 of the exact original ROI straight-sRGB RGBA8 bytes. */
  readonly sourceDigest: string;
  readonly settings?: Readonly<Record<string, unknown>>;
}
export interface AdapterContext<T extends Task = Task> {
  readonly jobId: string;
  readonly task: T;
  readonly model: ModelDescriptor;
  readonly originalSize: Readonly<{ width: number; height: number }>;
  readonly roi: OriginalROI;
  /** Isolated ROI copy. Full-strength output is required; the runner applies strength once. */
  readonly source: Image;
  /** Isolated edit-mask copy, not an inferred person matte. */
  readonly mask: Mask;
  readonly signal: AbortSignal;
}
export interface ImageAdapterResult<T extends Exclude<Task, 'matting'> = Exclude<Task, 'matting'>> {
  readonly provenance: Provenance<T>;
  /** Exact ROI size; original alpha is mandatory, even at masked-out ROI pixels. */
  readonly image: Image;
  readonly matte?: never;
  readonly foreground?: never;
}
export interface MattingAdapterResult {
  readonly provenance: Provenance<'matting'>;
  /** Foreground alpha multiplier, where 1 preserves and 0 removes original alpha. */
  readonly matte: Mask;
  /** Optional classical color estimate. Exact ROI, straight sRGB, source alpha byte-exact.
   * Original RGB is required where source alpha < 255 or matte == 1.
   * Ignored for compositing unless Request.applyForeground is explicitly true. */
  readonly foreground?: Image;
  readonly image?: never;
}
export type AdapterResult = ImageAdapterResult | MattingAdapterResult;
export interface Adapter {
  readonly descriptor: ModelDescriptor;
  run(context: AdapterContext): AdapterResult | Promise<AdapterResult>;
}
export interface Request {
  readonly task: Task;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly roi: OriginalROI;
  readonly mask: Mask;
  readonly strength: number;
  /** Matting only; default false. Requires a validated separate foreground plane.
   * Uses linear-light premultiplied blending inside mask * strength only. */
  readonly applyForeground?: boolean;
  /** Only with applyForeground:true. Independent [0,1] linear-light color influence,
   * default 0. Zero preserves source RGB exactly while requested matte alpha still applies. */
  readonly foregroundStrength?: number;
  readonly signal?: AbortSignal;
}
export type JobResult = Readonly<{
  jobId: string;
  task: Task;
  /** Full original dimensions; independent bytes owned by the caller. */
  image: Image;
}> & (Readonly<{ status: 'noop'; provenance: null }> | Readonly<{ status: 'completed'; provenance: Provenance }>);
export interface Job {
  readonly id: string;
  readonly state: JobState;
  readonly result: Promise<JobResult>;
  /** Immediately rejects result and signals the adapter. False if already settled. */
  cancel(): boolean;
}
export interface SessionOptions {
  readonly adapters?: readonly Adapter[];
  readonly maxPixels?: number;
  /** Test harnesses only. The result remains labelled test-double, never model. */
  readonly allowTestDoubles?: boolean;
}
export interface BackendSession {
  /** Validates synchronously, then supersedes the previous unfinished job. */
  start(request: Request): Job;
  getOriginal(): Image;
  listModels(): readonly ModelDescriptor[];
  dispose(): void;
}
export declare const TASKS: readonly Task[];
export declare const DEFAULT_MAX_PIXELS: number;
export declare class BackendContractError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown });
}
export declare function createBackendSession(original: Image, options?: SessionOptions): BackendSession;
