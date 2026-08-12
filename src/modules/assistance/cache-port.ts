import type {
  DeepDiveGeneration,
  GenerationRequest,
  QuickHintGeneration,
  CustomGeneration,
} from './generation-port';

export type CachedGeneration =
  | Omit<QuickHintGeneration, 'usage'>
  | Omit<DeepDiveGeneration, 'usage'>
  | Omit<CustomGeneration, 'usage'>;

export interface CachePort {
  get(request: GenerationRequest): Promise<CachedGeneration | null>;
  put(
    request: GenerationRequest,
    generation: CachedGeneration,
  ): Promise<void>;
}
