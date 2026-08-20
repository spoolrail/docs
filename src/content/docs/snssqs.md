---
title: AWS SNS/SQS
description: Configure AWS SNS/SQS delivery, FIFO ordering, batching, and managed topology.
---

The AWS SNS/SQS driver publishes to Amazon SNS and gives every Spoolrail subscription its own Amazon SQS queue. FIFO topology is the default; standard topology is available per connection.

## Driver Prerequisites

Install `aws/aws-sdk-php` 3.392.0 or later using Composer:

```bash
composer require aws/aws-sdk-php:^3.392.0
```

Configure the AWS account, credentials, and Region in `.env`:

```dotenv
AWS_ACCESS_KEY_ID=<your-key-id>
AWS_SECRET_ACCESS_KEY=<your-secret-access-key>
AWS_DEFAULT_REGION=us-east-1
AWS_ACCOUNT_ID=<your-account-id>
```

`AWS_ACCOUNT_ID` is the 12-digit ID of the account that owns your SNS topics and SQS queues. Set `AWS_SESSION_TOKEN` when using temporary AWS credentials.

If your application authenticates through the AWS SDK's default credential provider chain, such as an IAM role, leave `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` undefined.

## Configuration

Publish `config/spoolrail.php` to configure the bundled connection:

```php
'snssqs' => [
    'driver' => 'snssqs',
    'key' => env('AWS_ACCESS_KEY_ID'),
    'secret' => env('AWS_SECRET_ACCESS_KEY'),
    'token' => env('AWS_SESSION_TOKEN'),
    'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    'account_id' => env('AWS_ACCOUNT_ID'),
    'endpoint' => env('SPOOLRAIL_AWS_ENDPOINT'),
    'fifo' => true,
    'receive_batch_size' => 10,
    'visibility_timeout' => 30,
    'connection_timeout' => 3,
    'request_timeout' => 60,
],
```

Set `SPOOLRAIL_AWS_ENDPOINT` when using a compatible local service such as MiniStack. Leave it undefined when connecting to AWS.

SQS consumers long-poll for 20 seconds, so any custom `request_timeout` value must be greater than 20.

### Receive Batch Size

`receive_batch_size` controls how many messages Spoolrail fetches from the SQS queue per receive. Fetching several messages at once avoids a broker round trip for each message. It defaults to `10`, the AWS maximum. Set it to `1` for one-at-a-time receives. SQS returns up to the configured number without waiting for a full batch to accumulate. Spoolrail hands returned messages to Laravel queue one at a time.

After SQS returns a batch, the visibility timeout controls how long an undeleted message remains unavailable for another receive from that subscription's queue. The default `visibility_timeout` is `30` seconds. See AWS's [`VisibilityTimeout` attribute documentation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SetQueueAttributes.html) for supported values. Spoolrail deletes each message after handing it to Laravel queue, so later worker execution does not use this time. Increase the timeout when queue handoff may take longer, but expect a longer redelivery delay after a consumer failure. Run `spoolrail:sync` after changing it.

## FIFO Mode and Ordering

FIFO mode is enabled by default. This preserves message order and deduplicates repeated publications within each message group. Spoolrail creates `.fifo` SNS topics and SQS queues with [high throughput](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html) enabled.

Without an ordering key, every message for a logical topic uses the same message group. This gives you topic-wide ordering, but even in high-throughput mode, AWS allows that message group to deliver up to 300 messages per second. To increase topic throughput, assign different [ordering keys](/messages/#ordering-keys) to independent message sequences. Messages sharing an ordering key remain ordered, while different keys may progress in parallel.

Publishing the same `Message` more than once reuses its UUID, so AWS FIFO may deduplicate those publications when they use the same group.

FIFO ordering ends when Spoolrail hands a delivery to Laravel queue; handler concurrency and retries may change execution or completion order.

AWS publishes current per-group and regional limits in its [SNS message-group guidance](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-grouping.html) and [SNS service quotas](https://docs.aws.amazon.com/general/latest/gr/sns.html).

## Standard Mode

Set `'fifo' => false` to create unsuffixed standard topics and queues. Standard mode avoids FIFO's per-group throughput and sequencing constraints, but provides at-least-once, best-effort-order delivery instead of FIFO ordering.

> [!NOTE]
> In standard mode, ordering keys enable [fair-queue grouping](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fair-queues.html), not ordering or deduplication.

### Moving from FIFO to Standard

AWS cannot convert an existing FIFO topic or queue to standard. Migrate without losing messages:

1. Keep the FIFO connection configured. Add a separately named standard connection with `'fifo' => false`, declare replacement subscriptions with new names, and run `spoolrail:sync`.
2. Switch publishers to the standard connection. Keep the FIFO connection available for pending outbox publications.
3. Continue the FIFO consumers until their SQS deliveries and related Laravel queue work are drained. Keep the route while you still need to accept delayed SNS delivery retries.
4. Remove the FIFO declarations, then delete their receive resources and unused topic using the [cleanup commands](/subscriptions/#removing-resources).
5. Remove the FIFO connection after its pending outbox publications and resources are gone.

Changing `fifo` on the existing connection before draining it redirects logical names to replacement resources and can strand old work.

## Managed Topology

After declaring subscriptions, run [topology synchronization](/subscriptions/#synchronizing-topology). When synchronization needs to create resources, the AWS credentials it uses must belong to the configured `account_id`.

For each declaration, Spoolrail creates or verifies:

- a shared SNS topic named `{topic}.fifo` in FIFO mode or `{topic}` in standard mode;
- an application-owned SQS queue named `{ownership-prefix}-{subscription}` with `.fifo` in FIFO mode;
- an SQS policy allowing that topic to send to the queue; and
- a raw-message-delivery SNS subscription connecting the topic to the queue.

## IAM Permissions

Runtime publishing requires:

```text
sns:Publish
```

Runtime consumption requires:

```text
sqs:GetQueueUrl
sqs:ReceiveMessage
sqs:DeleteMessage
```

Topology changes require:

```text
sns:CreateTopic
sns:GetTopicAttributes
sns:ListSubscriptionsByTopic
sns:GetSubscriptionAttributes
sns:Subscribe
sns:Unsubscribe
sns:DeleteTopic

sqs:ListQueues
sqs:CreateQueue
sqs:GetQueueUrl
sqs:GetQueueAttributes
sqs:SetQueueAttributes
sqs:DeleteQueue
```

The AWS-managed [**AmazonSNSFullAccess**](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonSNSFullAccess.html) and [**AmazonSQSFullAccess**](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonSQSFullAccess.html) policies cover the runtime and topology permissions listed above.
