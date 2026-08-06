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

declare(strict_types=1);

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
    public function publish(string $topic, string $body, array $headers): void;

    /**
     * @param Closure(string, TransportContext): void $handoff
     */
    public function consume(string $subscription, Closure $handoff): void;
}
```

`publish` receives the selected topic, the encoded message body, and a portable header map already validated by Spoolrail. Send the body unchanged, map the headers into the transport's native application-header facility, and return only after the transport has accepted the publication.

Configure finite connection and publication timeouts in the driver. This operation must always terminate because the transactional outbox dispatcher invokes it synchronously and does not impose a transport-independent timeout.

Throw `PublicationException::notSent(...)` when the publication failed before it could be sent, `PublicationException::rejected()` when the transport explicitly rejected it, and `PublicationException::outcomeUnknown(...)` when acceptance cannot be established. Preserve the transport failure as the supplied previous exception. The distinction determines whether callers know the message was not accepted or must account for a possible duplicate.

`consume` must retain ownership of a delivery while calling `$handoff($body, $transportContext)`. The context is a `TransportContext` with non-empty `driver`, `connectionName`, `topic`, and `subscription` values and a string-keyed native `headers` array. Use an empty header array when the delivery has none.

Set `transportMessageId` and `transportPublishedAt` only from values assigned by the transport, and set them to `null` when the transport does not expose those facts. Set `redelivered` to the transport's delivery evidence or `null` when it cannot report that evidence. Do not place acknowledgement, receipt, or settlement handles in the context.

Settle the delivery only when the callback returns normally. If it throws, make the delivery available again, stop consuming, and propagate the same exception. If settling the delivery fails after the handoff returns, stop consuming and surface the failure.

These rules preserve Spoolrail's at-least-once behavior across transports.

## Closing Connections

Implement `CanClose` when the driver owns a client or connection that must be released:

```php
use Spoolrail\Spoolrail\Contracts\CanClose;

public function close(): void
{
    $this->client->disconnect();
}
```

`Spoolrail::forgetConnection('events')` closes drivers supporting this contract before removing the cached connection.

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

The purpose of these methods is not immediately obvious, so here is an overview of each method:

- The `planSync` method should inspect the transport without changing it and return a `TopologyPlan`. Spoolrail collects a plan for every managed connection before applying any plan, so a preflight failure prevents every plan from being applied.
- The `undeclaredSubscriptionResourceNames` method should return the physical subscription resources owned by the supplied prefix that are not represented by the supplied declarations. Spoolrail passes each returned name to `deleteSubscription` when running the undeclared-subscription deletion command.
- The `deleteSubscription` method should permanently delete the supplied physical subscription resource.
- The `deleteTopic` method should delete the supplied logical topic. It should refuse the operation when the transport cannot establish that deleting the topic is safe.

A topology plan implements the `TopologyPlan` contract. A stubbed implementation looks like the following:

```php
<?php

namespace App\Spoolrail;

use Spoolrail\Spoolrail\Contracts\TopologyPlan;

class AcmeTopologyPlan implements TopologyPlan
{
    public function apply(): void {}
}
```

The `apply` method should perform only the creations established during `planSync`.
