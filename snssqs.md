# AWS SNS/SQS

The AWS SNS/SQS driver publishes to Amazon SNS and gives every Spoolrail subscription its own Amazon SQS queue. FIFO topology is the default; standard topology is available per connection. Install the optional AWS SDK as described in [Installation and Configuration](installation.md#installation) before selecting this driver.

## Connection Settings

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
    'connection_timeout' => 3,
    'request_timeout' => 60,
],
```

Typically, you should configure your AWS account and credentials using the following environment variables, which are referenced by the `config/spoolrail.php` configuration file:

```dotenv
AWS_ACCESS_KEY_ID=<your-key-id>
AWS_SECRET_ACCESS_KEY=<your-secret-access-key>
AWS_DEFAULT_REGION=us-east-1
AWS_ACCOUNT_ID=<your-account-id>
```

`AWS_ACCOUNT_ID` should contain the 12-digit ID of the account that owns your SNS topics and SQS queues. If you are using temporary AWS credentials, you should also define `AWS_SESSION_TOKEN`.

If your application authenticates using the AWS SDK's default credential provider chain, such as an IAM role, you may leave `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` undefined.

When using a compatible local service such as MiniStack, you may define its endpoint using `SPOOLRAIL_AWS_ENDPOINT`. This variable should be left undefined when connecting to AWS.

SQS consumers long-poll for 20 seconds. Therefore, any custom `request_timeout` value must be greater than 20.

## FIFO Mode and Ordering

FIFO mode is enabled by default. This preserves message order and deduplicates repeated publications within each message group. Spoolrail creates `.fifo` SNS topics and SQS queues with [high throughput](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html) enabled at no additional cost.

However, without an ordering key, every message for a logical topic uses the same message group. This gives you topic-wide ordering, but even in high-throughput mode, AWS allows that message group to deliver up to 300 messages per second. To increase topic throughput, assign different [ordering keys](messages.md#ordering-keys) to independent message sequences. Messages sharing an ordering key remain ordered, while different keys may progress in parallel.

Publishing the same `Message` more than once reuses its UUID, so AWS FIFO may deduplicate those publications when they use the same group.

FIFO ordering ends when Spoolrail hands a delivery to Laravel Queue; handler concurrency and retries may change execution or completion order.

AWS publishes current per-group and regional limits in its [SNS message-group guidance](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-grouping.html) and [SNS service quotas](https://docs.aws.amazon.com/general/latest/gr/sns.html).

## Standard Mode

Set `'fifo' => false` to create unsuffixed standard topics and queues. Standard mode avoids FIFO's per-group throughput and sequencing constraints, but provides at-least-once, best-effort-order delivery instead of FIFO ordering.

> **Note:** In standard mode, ordering keys enable [fair-queue grouping](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fair-queues.html), not ordering or deduplication.

### Moving from FIFO to Standard

AWS cannot convert an existing FIFO topic or queue to standard. The safe live path is create before destroy:

1. Keep the FIFO connection configured. Add a separately named standard connection with `'fifo' => false`, declare replacement subscriptions with new names, and run `spoolrail:sync`.
2. Switch publishers to the standard connection. Keep the FIFO connection available for pending outbox publications.
3. Continue the FIFO consumers until their SQS deliveries and related Laravel Queue work are drained. Retain the route for an appropriate period if late SNS delivery retries must still be accepted.
4. Remove the FIFO declarations, then delete their receive resources and unused topic using the [cleanup commands](subscriptions.md#removing-resources).
5. Remove the FIFO connection after its pending outbox publications and resources are gone.

Changing `fifo` on the existing connection before draining it redirects logical names to replacement resources and can strand old work.

## Managed Topology

After declaring subscriptions, run [topology synchronization](subscriptions.md#synchronizing-topology) with AWS credentials that have the required [topology permissions](#iam-permissions). When synchronization needs to create resources, those credentials must belong to the configured `account_id`.

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
