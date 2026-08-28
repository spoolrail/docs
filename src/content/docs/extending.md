---
title: Custom Drivers
---

## Registering a Driver

Define a custom connection in `config/spoolrail.php`:

```php
'connections' => [
    'events' => [
        'driver' => 'acme',
        'endpoint' => env('ACME_BROKER_ENDPOINT'),
    ],
],
```

Register its creator from an application service provider:

```php
<?php

namespace App\Providers;

use App\Spoolrail\AcmeClient;
use App\Spoolrail\AcmeDriver;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\ServiceProvider;
use Spoolrail\Spoolrail\Contracts\Driver;
use Spoolrail\Spoolrail\Facades\Spoolrail;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Spoolrail::extend(
            'acme',
            function (Application $app, array $config, string $connectionName): Driver {
                return new AcmeDriver(
                    client: $app->make(AcmeClient::class),
                    connectionName: $connectionName,
                    config: $config,
                );
            },
        );
    }
}
```

Spoolrail calls the creator when the connection is first used and caches the resulting connection.

## Driver Contract

Custom drivers implement `Driver`:

```php
use Closure;
use Spoolrail\Spoolrail\Delivery;
use Throwable;

/**
 * @template TReceipt
 */
interface Driver
{
    /**
     * @param array<string, string> $headers
     */
    public function publish(
        string $topic,
        string $body,
        array $headers,
        ?string $orderingKey = null,
    ): void;

    /**
     * @param Closure(list<Delivery<TReceipt>>): void $received
     * @param Closure(Throwable): void $fail
     */
    public function receive(
        string $subscription,
        Closure $received,
        Closure $fail,
    ): void;

    /**
     * @param Delivery<TReceipt> $delivery
     * @param Closure(): void $acknowledged
     * @param Closure(Throwable): void $fail
     */
    public function acknowledge(
        Delivery $delivery,
        Closure $acknowledged,
        Closure $fail,
    ): void;

    /**
     * @param Delivery<TReceipt> $delivery
     * @param Closure(): void $released
     * @param Closure(Throwable): void $fail
     */
    public function release(
        Delivery $delivery,
        Closure $released,
        Closure $fail,
    ): void;
}
```

`publish` receives the selected topic, encoded message body, portable header map, and optional ordering key after Spoolrail validates them. Send the body unchanged, map headers to the transport's native application headers, and map the ordering key to the closest native grouping mechanism. If the transport has no equivalent grouping feature, the driver may accept and ignore the key. Return only after the transport has accepted the publication.

Configure finite connection and publication timeouts in the driver. `publish` must return or throw because the transactional outbox dispatcher calls it synchronously and does not impose a transport-independent timeout.

Report publication failures with the exception that matches the outcome:

- `PublicationException::notSent(...)` when the publication failed before the driver could send it.
- `PublicationException::rejected(...)` when the transport rejected it.
- `PublicationException::outcomeUnknown(...)` when the driver cannot establish whether the transport accepted it.

Pass the transport failure as the previous exception.

Each `publish` call is one broker attempt. Spoolrail retries the driver call according to `spoolrail.publisher_retries` and does not retry a `Rejected` outcome.

Each consumption method starts one transport operation and then invokes exactly one supplied outcome closure exactly once. It may do that before returning or later. Returning only means that the operation was accepted.

`receive` represents one receive attempt and reports a `list<Delivery>`. An empty list is a successful result. Spoolrail decides when the subscription receives again. Keep the native receipt in `Delivery::$receipt`; Spoolrail returns the same delivery to `acknowledge` or `release` without exposing that receipt to application handlers.

Bind the receipt type once so PHPStan can infer it inside settlement methods:

```php
/** @implements Driver<AcmeReceipt> */
class AcmeDriver implements Driver
{
    // ...
}
```

Set `body` to the unchanged encoded message. Use `headers` for string-keyed native application headers. Set `transportMessageId` and `transportPublishedAt` only from values assigned by the transport. Set `redelivered` to the transport's delivery evidence or `null` when unknown, and set `orderingKey` from the native grouping identifier when available. Routing identity is already known from the subscription declaration and does not belong in the delivery or receipt.

`acknowledge` positively settles a delivery. `release` makes it eligible for redelivery as soon as the transport permits; it must not add delay or retry policy. Invoke `$fail($exception)` only for a failure confined to that operation and subscription. After `$fail`, the driver must remain usable by other subscriptions and later operations. Throw instead when the connection, reactor, or other shared driver state is no longer usable so Spoolrail can restart the whole child.

A synchronous driver completes inline through the same callbacks:

```php
public function receive(string $subscription, Closure $received, Closure $fail): void
{
    try {
        $native = $this->client->receive($subscription);
        $deliveries = $native === null ? [] : [new Delivery(
            body: $native->body,
            receipt: $native->receipt,
        )];
    } catch (Throwable $exception) {
        $fail($exception);

        return;
    }

    $received($deliveries);
}
```

When operations can remain pending after these methods return, implement `CanWaitForConsumerIo`:

```php
use Spoolrail\Spoolrail\Contracts\CanWaitForConsumerIo;

class AcmeDriver implements CanWaitForConsumerIo, Driver
{
    public function waitForConsumerIo(): void
    {
        $this->reactor->tick();
    }
}
```

Start asynchronous requests from `receive`, `acknowledge`, and `release`, attach the supplied outcome closures, and return. `waitForConsumerIo` gives the shared reactor one bounded opportunity to progress any subscription's pending I/O. Configure its wait from `spoolrail.consumer.idle_wait_milliseconds`; do not reinterpret that value as a broker-request timeout. Throw from `waitForConsumerIo` if the reactor itself fails.

## Closing Connections

Implement `CanClose` when the driver needs to close a client or connection:

```php
use Spoolrail\Spoolrail\Contracts\CanClose;

public function close(): void
{
    $this->client->disconnect();
}
```

## Managing Topology

Implement `CanManageTopology` when the transport can synchronize and remove broker resources. Without it, publishing and consuming still work, but topology commands report the connection as unmanaged:

```php
<?php

namespace App\Spoolrail;

use Spoolrail\Spoolrail\Contracts\CanManageTopology;
use Spoolrail\Spoolrail\Contracts\TopologyPlan;

class AcmeDriver implements CanManageTopology
{
    public function planSync(
        array $subscriptions,
        string $ownershipPrefix,
    ): TopologyPlan {}

    public function undeclaredSubscriptionResourceNames(
        array $subscriptions,
        string $ownershipPrefix,
    ): array {}

    public function deleteSubscription(string $physicalName): void {}

    public function deleteTopic(string $topic): void {}
}
```

The methods divide topology management into inspection and explicit deletion:

- `planSync` inspects the transport without changing it and returns a `TopologyPlan`. Spoolrail collects a plan for every managed connection before applying any plan. If preflight fails, Spoolrail applies none of them.
- `undeclaredSubscriptionResourceNames` returns physical subscription resources owned by the supplied prefix but absent from the supplied declarations. The undeclared-subscription deletion command passes each returned name to `deleteSubscription`.
- `deleteSubscription` permanently deletes the supplied physical subscription resource.
- `deleteTopic` deletes the supplied logical topic. It must refuse the operation when the transport cannot establish that deletion is safe.

A topology plan implements the `TopologyPlan` contract. A minimal implementation:

```php
<?php

namespace App\Spoolrail;

use Spoolrail\Spoolrail\Contracts\TopologyPlan;

class AcmeTopologyPlan implements TopologyPlan
{
    public function apply(): void {}
}
```

The `apply` method creates only the resources established during `planSync`.

If discovery encounters a short-lived service or rate-limit failure, or an apply request may have succeeded before failing, throw `TopologySyncRequiresRetryException::afterFailure($exception)`. Spoolrail will wait one second, discard the remaining plan, inspect every connection again, and retry synchronization once. Report permanent refusals and incompatible topology without this exception.
