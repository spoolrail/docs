---
title: Google Pub/Sub
description: Configure Google Pub/Sub delivery, ordering, batching, and managed topology.
---

The Google Pub/Sub driver publishes to a shared topic and gives every Spoolrail subscription its own pull subscription. Message ordering and exactly-once delivery are enabled by default and can be configured independently.

## Driver Prerequisites

Install `google/cloud-pubsub` 2.20.0 or later using Composer:

```bash
composer require google/cloud-pubsub:^2.20.0
```

Configure the project, absolute path to a service-account credential file, and one [locational endpoint](https://cloud.google.com/pubsub/docs/reference/service_apis_overview#list_of_locational_endpoints) in `.env`:

```dotenv
GOOGLE_CLOUD_PROJECT=warehouse-production
SPOOLRAIL_GOOGLE_CREDENTIALS=/run/secrets/warehouse-pubsub.json
SPOOLRAIL_GOOGLE_PUBSUB_ENDPOINT=europe-west1-pubsub.googleapis.com:443
```

## Configuration

Publish `config/spoolrail.php` to configure the bundled connection:

```php
'pubsub' => [
    'driver' => 'pubsub',
    'project_id' => env('GOOGLE_CLOUD_PROJECT'),
    'credentials' => env('SPOOLRAIL_GOOGLE_CREDENTIALS'),
    'endpoint' => env('SPOOLRAIL_GOOGLE_PUBSUB_ENDPOINT'),
    'message_ordering' => true,
    'exactly_once' => true,
    'receive_batch_size' => 10,
    'acknowledgment_deadline' => 30,
],
```

`project_id` identifies the Google Cloud project that owns the topics and subscriptions. Spoolrail always uses the REST transport and does not require the gRPC PHP extension.

### Receive Batch Size

`receive_batch_size` controls how many messages Spoolrail fetches from Pub/Sub per receive. Fetching several messages at once avoids a broker round trip for each message. It defaults to `10` and accepts values from `1` through `1,000`. Set it to `1` for one-at-a-time receives. Pub/Sub may return fewer messages than requested, and each response is limited to 10 MB. Spoolrail hands returned messages to Laravel queue one at a time.

After Pub/Sub returns a batch, the acknowledgment deadline controls how long an unacknowledged message remains unavailable for another pull from that subscription. The default `acknowledgment_deadline` is `30` seconds. See Google's [acknowledgment deadline documentation](https://cloud.google.com/pubsub/docs/subscription-properties) for supported values. Spoolrail acknowledges each message after handing it to Laravel queue, so later worker execution does not use this time. Increase the deadline when queue handoff may take longer, but expect a longer redelivery delay after a consumer failure. Run `spoolrail:sync` after changing it.

## Application Default Credentials

To use [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials), leave `SPOOLRAIL_GOOGLE_CREDENTIALS` unset. Set `GOOGLE_APPLICATION_CREDENTIALS` when ADC should read a credential file:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-credentials.json
```

ADC also supports attached service accounts, Workload Identity Federation, and local credentials created with the Google Cloud CLI.

## Global Endpoint

Applications running inside Google Cloud can leave `SPOOLRAIL_GOOGLE_PUBSUB_ENDPOINT` unset to use the [global Pub/Sub endpoint](https://cloud.google.com/pubsub/docs/reference/service_apis_overview#global_endpoint). Google routes those requests to Pub/Sub in the region where they originate.

## Message Ordering

Message ordering is enabled by default. Publications without an application [ordering key](/messages/#ordering-keys) share one ordered lane per topic. An explicit key selects an independent lane. Different groups can progress in parallel while messages within each group stay ordered.

Pub/Sub preserves order within a key and region, independently for each subscription. Google documents a [1 MB/s publishing limit per ordering key](https://cloud.google.com/pubsub/docs/ordering); use multiple ordering keys when a topic must exceed that per-key throughput.

## Disabling Message Ordering

When the application does not require guaranteed ordering, set `'message_ordering' => false` to favor higher publish availability and lower end-to-end latency.

> [!NOTE]
> You do not need to remove ordering keys from existing publication calls. Pub/Sub accepts the keys, but does not guarantee their delivery order for subscriptions with message ordering disabled.

The `message_ordering` setting is fixed when a subscription is created. If `spoolrail:sync` finds an existing subscription with a different value, preflight fails before changing topology. Declare a replacement subscription with a new name, drain the original, and remove it through the normal [resource cleanup](/subscriptions/#removing-resources) workflow.

## Exactly-Once Delivery

Exactly-once delivery is enabled by default to prevent duplicate broker deliveries.

Set `'exactly_once' => false` to use ordinary at-least-once delivery when lower latency or maximum throughput matters more than duplicate-delivery protection. Note that [regional quotas](https://docs.cloud.google.com/pubsub/quotas) only become relevant when Pub/Sub sends your application more than 180,000 messages per minute.

Exactly-once delivery is not fixed when a subscription is created. Change `exactly_once` and run `spoolrail:sync` to update existing subscriptions in place.

## Managed Topology

After declaring subscriptions, run [topology synchronization](/subscriptions/#synchronizing-topology). For each declaration, Spoolrail creates or verifies:

- a shared topic named `{topic}`; and
- an application-owned pull subscription named `{ownership-prefix}-{subscription}` with the connection's ordering and exactly-once settings.

Publishing and consuming never create these resources as a side effect.

An existing managed subscription must remain attached to the declared topic and use pull delivery. If the physical subscription with that name has another topic or delivery type, synchronization reports incompatible topology instead of repurposing it. Declare a replacement subscription, drain the original, and then remove it.

## IAM Permissions

Runtime publishing requires:

```text
pubsub.topics.publish
```

Runtime consumption requires:

```text
pubsub.subscriptions.consume
```

Topology inspection and changes require:

```text
pubsub.topics.get
pubsub.topics.create
pubsub.topics.delete
pubsub.topics.attachSubscription

pubsub.subscriptions.get
pubsub.subscriptions.list
pubsub.subscriptions.create
pubsub.subscriptions.update
pubsub.subscriptions.delete
```

The predefined **Pub/Sub Publisher** and **Pub/Sub Subscriber** roles cover the runtime permissions, while **Pub/Sub Editor** covers the listed topology operations as well as runtime access. Google maintains the authoritative [Pub/Sub IAM permission reference](https://cloud.google.com/pubsub/docs/access-control).
