export type AmplifyAiModelResolverCustomResourceProps = {
  modelId: string;
  region: string;
  crossRegionInference: boolean;
};

export type AmplifyAiModelResolverCustomResourceOutput = {
  modelId: string;
  modelArns: string[];
};
