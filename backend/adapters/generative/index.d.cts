/** Main-process adapters only. No keys or confirmation functions belong in a renderer bridge. */
export interface Image {
  width: number; height: number; format: 'rgba8'; alphaMode: 'straight'; colorSpace: 'srgb';
  data: Uint8Array | Uint8ClampedArray;
}
export interface Mask {
  width: number; height: number; space: 'original-pixels'; encoding: 'unit-float32'; data: Float32Array;
}
export interface Codec {
  /** Encode normalized pixels as fresh metadata-free PNG; never return an original photo file. */
  encodePNG(image: Image): Uint8Array | Promise<Uint8Array>;
  /** Must validate PNG decoding and return straight-alpha RGBA, not raw native BGRA. */
  decodePNG(bytes: Uint8Array): Image | Promise<Image>;
  /** Used only after explicit resize-to-source consent; preserve documented color/alpha semantics. */
  resizeRGBA?(image: Image, width: number, height: number): Image | Promise<Image>;
}
export interface ProviderDescriptor {
  readonly id: string; readonly name: string; readonly models: readonly string[];
  readonly enabled: boolean; readonly nativeMask: boolean; readonly endpoint: string | null;
  readonly pricingUrl: string; readonly documentationUrl: string;
  readonly validation: 'mock-tested-only'; readonly liveValidated: false;
}
export interface ProviderRequest {
  task: 'instruction-edit' | 'inpaint'; model: string; prompt: string;
  sourcePng: Uint8Array; maskPng: Uint8Array | null;
  outputSize: Readonly<{width:number;height:number}>;
  quality: 'low'|'medium'|'high'|'xhigh'|'max'; signal: AbortSignal;
}
export interface Provider {
  readonly descriptor: ProviderDescriptor;
  /** Internal trusted entry point; app integration must use the consent-gated session. */
  run(request: ProviderRequest): Promise<{png: Uint8Array; requestId: string | null}>;
}
export interface ProviderConfig {
  enabled?: boolean;
  /** Resolve a user-configured credential only after per-job approval. Never log or persist here. */
  getApiKey?: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
}
export interface AlibabaConfig extends ProviderConfig { workspaceId?: string; region?: 'ap-southeast-1'|'cn-beijing'; }
export interface EditRequest {
  task: 'instruction-edit'|'inpaint'; providerId:string; model:string; prompt:string; mask:Mask; strength:number;
  geometryPolicy?: 'require-source-size'|'resize-to-source';
  outputSize?: {width:number;height:number}; quality?: 'low'|'medium'|'high'|'xhigh'|'max';
}
export interface PreparedSummary {
  readonly preparedId:string; readonly requestDigest:string; readonly photoRevision:string; readonly expiresAt:number;
  readonly providerId:string; readonly providerName:string; readonly endpoint:string|null; readonly model:string;
  readonly task:'instruction-edit'|'inpaint'; readonly prompt:string;
  readonly sourceSize:Readonly<{width:number;height:number}>; readonly outputSize:Readonly<{width:number;height:number}>;
  readonly sourceSha256:string; readonly maskSha256:string; readonly uploadBytes:number;
  readonly quality:string; readonly strength:number; readonly geometryPolicy:'require-source-size'|'resize-to-source';
  readonly nativeMask:boolean; readonly disclosure:string;
  readonly cost:Readonly<{type:'metered';estimate:null;hardCapEnforced:false;pricingUrl:string;disclosure:string}>;
}
export interface Approval { approved:boolean; preparedId:string; requestDigest:string; }
export interface Provenance {
  readonly kind:'api'; readonly providerId:string; readonly model:string; readonly providerRequestId:string|null;
  readonly jobId:string; readonly photoRevision:string; readonly requestDigest:string;
  readonly sourceSha256:string; readonly maskSha256:string; readonly generatedSize:Readonly<{width:number;height:number}>;
  readonly transform:'none'|'explicit-resize-to-source'; readonly nativeMask:boolean;
  readonly validation:'live-result-not-quality-validated';
}
export interface Candidate { readonly candidateId:string; readonly image:Image; readonly provenance:Provenance; }
export interface Job {
  readonly id:string;
  readonly state:'queued'|'awaiting-confirmation'|'running'|'succeeded'|'failed'|'cancelled'|'superseded';
  readonly result:Promise<Candidate>; cancel():boolean;
}
export interface Session {
  prepare(request:EditRequest):Promise<PreparedSummary>; start(preparedId:string):Job;
  listProviders():readonly ProviderDescriptor[]; getOriginal():Image;
  accept(candidateId:string):Readonly<{image:Image;provenance:Provenance}>; reject(candidateId:string):boolean;
  /** Irreversibly close on photo revision changes. Open a new session for the new revision. */
  invalidate():void; dispose():void;
}
export interface SessionOptions {
  image:Image; photoRevision:string; codec:Codec; providers?:readonly Provider[];
  /** Trusted main-process dialog. Never implement as a renderer-controlled boolean. */
  confirmUpload?:(summary:PreparedSummary,signal:AbortSignal)=>Approval|Promise<Approval>;
  timeoutMs?:number; now?:()=>number;
}
export class GenerativeError extends Error { readonly code:string; constructor(code:string,message:string); }
export function createGenerativeSession(options:SessionOptions):Session;
export function createOpenAIProvider(config?:ProviderConfig):Provider;
export function createAlibabaProvider(config?:AlibabaConfig):Provider;
export const OPENAI_MODELS:readonly string[];
export const ALIBABA_MODELS:readonly string[];
