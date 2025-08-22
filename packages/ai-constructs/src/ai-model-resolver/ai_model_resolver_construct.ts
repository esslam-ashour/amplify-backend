import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime as LambdaRuntime } from 'aws-cdk-lib/aws-lambda';
import { CustomResource, Duration, Fn } from 'aws-cdk-lib';
import path from 'node:path';
import { Provider } from 'aws-cdk-lib/custom-resources';
import {
  AmplifyAiModelResolverCustomResourceOutput,
  AmplifyAiModelResolverCustomResourceProps,
} from './lambda/ai_model_resolver_types.js';
import * as iam from 'aws-cdk-lib/aws-iam';

const dirname = __dirname;
const resourcesRoot = path.normalize(path.join(dirname, 'lambda'));
const aiModelResolverLambdaFilePath = path.join(
  resourcesRoot,
  'ai_model_resolver.js',
);

const AI_MODEL_RESOLVER_RESOURCE_TYPE =
  'Custom::AmplifyAiModelResolverResource';

/**
 * CDK construct that generates AI model ARNs using a custom resource.
 * Handles both foundation models and inference profiles based on configuration.
 */
export class AiModelResolverConstruct extends Construct {
  private readonly provider: Provider;

  /**
   * Creates a new AI model ARN generator construct.
   */
  constructor(scope: Construct) {
    super(scope, 'AmplifyAiModelResolver');

    const aiModelResolverLambda = new NodejsFunction(
      this,
      'AiModelResolverCustomResourceLambda',
      {
        runtime: LambdaRuntime.NODEJS_20_X,
        timeout: Duration.seconds(10),
        entry: aiModelResolverLambdaFilePath,
        handler: 'handler',
        bundling: {
          // TODO Remove it when Lambda serves SDK 3.440.0+
          // https://github.com/aws-amplify/amplify-backend/issues/561
          // This is added to force bundler to include local version of AWS SDK.
          // Lambda provided version does not have 'backend.stackArn' yet.
          externalModules: [],
        },
      },
    );

    aiModelResolverLambda.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:GetFoundationModel',
          'bedrock:GetInferenceProfile',
          'bedrock:ListInferenceProfiles',
        ],
        resources: [
          `arn:aws:bedrock:*:*:foundation-model/*`,
          `arn:aws:bedrock:*:*:inference-profile/*`,
        ],
      }),
    );

    this.provider = new Provider(this, 'AiModelResolverCustomResourceHandler', {
      onEventHandler: aiModelResolverLambda,
    });
  }

  /**
   * pass
   */
  public resolveAiModel(
    input: AmplifyAiModelResolverCustomResourceProps,
  ): AmplifyAiModelResolverCustomResourceOutput {
    const resource = new CustomResource(this, 'AiModelResolverCustomResource', {
      serviceToken: this.provider.serviceToken,
      properties: input,
      resourceType: AI_MODEL_RESOLVER_RESOURCE_TYPE,
    });

    return {
      modelId: resource.getAttString('modelId').toString(),
      modelArns: Fn.split(',', resource.getAtt('modelArns').toString()),
    };
  }
}
