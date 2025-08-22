import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceSuccessResponse,
} from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import {
  BedrockClient,
  GetFoundationModelCommand,
  GetInferenceProfileCommand,
  InferenceProfileSummary,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import {
  AmplifyAiModelResolverCustomResourceOutput,
  AmplifyAiModelResolverCustomResourceProps,
} from './ai_model_resolver_types.js';

/**
 * Handles custom resource events.
 */
export class AmplifyAiModelResolverResourceEventHandler {
  /**
   * Creates the custom resource event handler.
   */
  constructor() {}

  handleCustomResourceEvent = async (
    event: CloudFormationCustomResourceEvent,
  ): Promise<CloudFormationCustomResourceSuccessResponse> => {
    console.info(`Received '${event.RequestType}' event`);

    const physicalId =
      event.RequestType === 'Create' ? randomUUID() : event.PhysicalResourceId;

    const props =
      event.ResourceProperties as unknown as AmplifyAiModelResolverCustomResourceProps;

    let data: AmplifyAiModelResolverCustomResourceOutput | undefined;

    switch (event.RequestType) {
      case 'Create':
      case 'Update':
        console.info(
          `Resolving AI model with modelId=${props.modelId}, crossRegionInference=${props.crossRegionInference} in ${props.region}`,
        );
        data = await this.resolveAiModel(
          props.modelId,
          props.region,
          props.crossRegionInference,
        );
        break;
      case 'Delete':
        console.info('Handling delete event');
        break;
    }

    return {
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      PhysicalResourceId: physicalId,
      StackId: event.StackId,
      Status: 'SUCCESS',
      Data: {
        modelId: data?.modelId,
        modelArns: data?.modelArns.join(','),
      },
    } as CloudFormationCustomResourceSuccessResponse;
  };

  public resolveAiModel = async (
    modelId: string,
    region: string,
    crossRegionInference: boolean,
  ): Promise<AmplifyAiModelResolverCustomResourceOutput> => {
    const bedrockClient = new BedrockClient({ region });

    // Check if input is already an inference profile ID
    if (this.matchesInferenceProfile(modelId)) {
      return this.resolveInferenceProfile(bedrockClient, modelId);
    }

    return this.resolveFoundationModel(
      bedrockClient,
      modelId,
      crossRegionInference,
    );
  };

  private matchesInferenceProfile = (modelId: string): boolean => {
    // Inference profile IDs follow pattern: geography.provider.model-name.version:variant
    // They start with a geography (us, eu, etc.) not a provider name
    return /^(us|eu|apac|ca)\.[a-z0-9-]+(\.[a-z0-9-]+)*(:[0-9]+)?$/.test(
      modelId,
    );
  };

  private resolveInferenceProfile = async (
    bedrockClient: BedrockClient,
    modelId: string,
  ): Promise<AmplifyAiModelResolverCustomResourceOutput> => {
    const response = await bedrockClient.send(
      new GetInferenceProfileCommand({ inferenceProfileIdentifier: modelId }),
    );

    if (!response.inferenceProfileId || !response.inferenceProfileArn) {
      throw new Error(`Invalid or unsupported model ID ${modelId}`);
    }

    return {
      modelId: response.inferenceProfileId,
      modelArns: [
        response.inferenceProfileArn,
        ...(response.models?.map((model) => model.modelArn!).filter(Boolean) ||
          []),
      ],
    };
  };

  private resolveFoundationModel = async (
    bedrockClient: BedrockClient,
    modelId: string,
    crossRegionInference: boolean,
  ): Promise<AmplifyAiModelResolverCustomResourceOutput> => {
    const response = await bedrockClient.send(
      new GetFoundationModelCommand({ modelIdentifier: modelId }),
    );

    const modelDetails = response.modelDetails;
    if (!modelDetails?.modelId || !modelDetails.modelArn) {
      throw new Error(`Invalid or unsupported model ID ${modelId}`);
    }

    // Cast to string[] since SDK types don't include INFERENCE_PROFILE
    // See https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-bedrock/Variable/InferenceType/
    const inferenceTypes =
      (modelDetails.inferenceTypesSupported as unknown as string[]) || [];
    const requiresCri =
      inferenceTypes.length === 1 && inferenceTypes[0] === 'INFERENCE_PROFILE';
    const supportsCri = inferenceTypes.includes('INFERENCE_PROFILE');

    // Use inference profile if required or explicitly requested and supported
    if (requiresCri || (supportsCri && crossRegionInference)) {
      const inferenceProfile = await this.findInferenceProfile(
        bedrockClient,
        modelDetails.modelArn,
      );
      if (inferenceProfile) {
        return {
          modelId: inferenceProfile.inferenceProfileId!,
          modelArns: [
            inferenceProfile.inferenceProfileArn!,
            ...(inferenceProfile.models
              ?.map((model) => model.modelArn!)
              .filter(Boolean) || []),
          ],
        };
      }
    }

    // Return foundation model directly
    return {
      modelId: modelDetails.modelId,
      modelArns: [modelDetails.modelArn],
    };
  };

  private findInferenceProfile = async (
    bedrockClient: BedrockClient,
    foundationModelArn: string,
  ): Promise<InferenceProfileSummary | undefined> => {
    const response = await bedrockClient.send(
      new ListInferenceProfilesCommand({
        maxResults: 1000,
        typeEquals: 'SYSTEM_DEFINED',
      }),
    );

    return response.inferenceProfileSummaries?.find((profile) =>
      profile.models?.some((model) => model.modelArn === foundationModelArn),
    );
  };
}

const customResourceEventHandler =
  new AmplifyAiModelResolverResourceEventHandler();

/**
 * Entry point for the lambda-backend custom resource to resolve model IDs and ARNs.
 */
export const handler = (
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationCustomResourceSuccessResponse> => {
  return customResourceEventHandler.handleCustomResourceEvent(event);
};
