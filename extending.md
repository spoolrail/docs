# Custom Drivers

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
use Spoolrail\Spoolrail\TransportContext;

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
     * @param Closure(string, TransportContext): void $handoff
     */
    public function consume(string $subscription, Closure $handoff): void;
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

`consume` must retain ownership of a delivery while calling `$handoff($body, $transportContext)`. The context is a `TransportContext` with non-empty `driver`, `connectionName`, `topic`, and `subscription` values and a string-keyed native `headers` array. Use an empty header array when the delivery has none.

Set `transportMessageId` and `transportPublishedAt` only from values assigned by the transport, and set them to `null` when the transport does not expose those facts. Set `redelivered` to the transport's delivery evidence or `null` when it cannot report that evidence. Set `orderingKey` from the delivery's native group identifier when available; otherwise use `null`. Do not place acknowledgement, receipt, or settlement handles in the context.

Settle the delivery only when the callback returns normally. If it throws, make the delivery available again, stop consuming, and propagate the same exception. If settling the delivery fails after the handoff returns, stop consuming and report the failure.

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
    public function planSync(array $subscriptions, string $ownershipPrefix): TopologyPlan {}
    public function undeclaredSubscriptionResourceNames(array $subscriptions, string $ownershipPrefix): array {}
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
