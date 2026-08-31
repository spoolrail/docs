---
title: Events
---

Spoolrail dispatches synchronous Laravel events while publishing messages and handing received messages to Laravel Queue.

## Spoolrail Events

Register the events you need in a service provider's `boot` method:

> `MessageStaging`, `MessageStaged`, and `MessageStagingFailed` cover storing a publication in the transactional outbox.

```php
<?php

namespace App\Providers;

use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Spoolrail\Spoolrail\Events\MessageConsumed;
use Spoolrail\Spoolrail\Events\MessageConsuming;
use Spoolrail\Spoolrail\Events\MessageConsumptionFailed;
use Spoolrail\Spoolrail\Events\MessagePublicationFailed;
use Spoolrail\Spoolrail\Events\MessagePublished;
use Spoolrail\Spoolrail\Events\MessagePublishing;
use Spoolrail\Spoolrail\Events\MessageStaged;
use Spoolrail\Spoolrail\Events\MessageStaging;
use Spoolrail\Spoolrail\Events\MessageStagingFailed;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Event::listen(function (MessagePublishing $event): void {
            // $event->connectionName
            // $event->topic
            // $event->message
            // $event->headers
            // $event->orderingKey
        });

        Event::listen(function (MessagePublished $event): void {
            // $event->connectionName
            // $event->topic
            // $event->message
            // $event->headers
            // $event->orderingKey
        });

        Event::listen(function (MessagePublicationFailed $event): void {
            // $event->connectionName
            // $event->topic
            // $event->message
            // $event->headers
            // $event->orderingKey
            // $event->exception
        });

        Event::listen(function (MessageStaging $event): void {
            // $event->connectionName
            // $event->topic
            // $event->message
            // $event->headers
            // $event->orderingKey
        });

        Event::listen(function (MessageStaged $event): void {
            // $event->connectionName
            // $event->topic
            // $event->message
            // $event->headers
            // $event->orderingKey
            // $event->outboxId
        });

        Event::listen(function (MessageStagingFailed $event): void {
            // $event->connectionName
            // $event->topic
            // $event->message
            // $event->headers
            // $event->orderingKey
            // $event->exception
        });

        Event::listen(function (MessageConsuming $event): void {
            // $event->message
        });

        Event::listen(function (MessageConsumed $event): void {
            // $event->message
        });

        Event::listen(function (MessageConsumptionFailed $event): void {
            // $event->message
            // $event->exception
        });
    }
}
```

## Laravel Queue Events

Spoolrail's consumption lifecycle ends when a job is pushed to Laravel Queue. Use [Laravel's Queue job events](https://laravel.com/framework/docs/queues#job-events) to observe the later handler-processing lifecycle, including execution, retries, and terminal failure.
