import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cdk from 'aws-cdk-lib';
import * as integ from '@aws-cdk/integ-tests-alpha';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

const app = new cdk.App();

const stack = new cdk.Stack(app, 'sqs-bucket-notifications');

const bucket1 = new s3.Bucket(stack, 'Bucket1', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
const queue = new sqs.Queue(stack, 'MyQueue');

bucket1.addObjectCreatedNotification(new s3n.SqsDestination(queue));

const bucket2 = new s3.Bucket(stack, 'Bucket2', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});
bucket2.addObjectCreatedNotification(new s3n.SqsDestination(queue), { suffix: '.png' });

const encryptedQueue = new sqs.Queue(stack, 'EncryptedQueue', { encryption: sqs.QueueEncryption.KMS });
bucket1.addObjectRemovedNotification(new s3n.SqsDestination(encryptedQueue));

const bucket3 = new s3.Bucket(stack, 'Bucket3WithSkipDestinationValidation', {
  notificationsSkipDestinationValidation: true,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
const queueWithIncorrectS3Permissions = new sqs.Queue(stack, 'MyQueueWithIncorrectS3Permissions');
queueWithIncorrectS3Permissions.addToResourcePolicy(
  new cdk.aws_iam.PolicyStatement({
    effect: cdk.aws_iam.Effect.DENY,
    actions: ['sqs:SendMessage'],
    principals: [new cdk.aws_iam.ServicePrincipal('s3.amazonaws.com')],
    resources: [queueWithIncorrectS3Permissions.queueArn],
  }));
bucket3.addEventNotification(s3.EventType.OBJECT_TAGGING_PUT, new s3n.SqsDestination(queueWithIncorrectS3Permissions));

const integTest = new integ.IntegTest(app, 'SQSBucketNotificationsTest', {
  testCases: [stack],
  diffAssets: true,
});

integTest.assertions
  // First remove the test notifications
  .awsApiCall('SQS', 'purgeQueue', {
    QueueUrl: queue.queueUrl,
  })
  .next(integTest.assertions
    .awsApiCall('S3', 'putObject', {
      Bucket: bucket2.bucketName,
      Key: 'image.png',
      Body: 'Some content',
    }))
  .next(integTest.assertions
    .awsApiCall('SQS', 'receiveMessage', {
      QueueUrl: queue.queueUrl,
      WaitTimeSeconds: 20,
    })
    .assertAtPath('Messages.0.Body.Records.0.s3.object.key', integ.ExpectedResult.stringLikeRegexp('image\\.png')));

app.synth();
