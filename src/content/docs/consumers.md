---
title: Running Consumers
---

## Starting Consumers

Run every active subscription on the default Spoolrail connection with one command:

```bash
php artisan spoolrail
```

Select another configured Spoolrail connection with `--connection`:

```bash
php artisan spoolrail --connection=events
```

Use a separate root command for each connection that the application consumes. To run one declared subscription through the same production runtime, pass its name:

```bash
php artisan spoolrail warehouse-orders
```

Spoolrail hands each delivery to the subscription's configured Laravel queue, where the message handler runs.

## Consumer Processes

When `spoolrail` starts, it divides the selected connection's subscriptions evenly among `consumer.processes` child processes. The setting defaults to `1`, so one child runs every subscription on that connection:

```php
'consumer' => [
    'processes' => 1,
    'idle_wait_milliseconds' => 100,
    'exception_cooldown' => 300,
],
```

A single child can wait for broker activity across many subscriptions at the same time. When several subscriptions have messages ready, it hands one message at a time to Laravel queue and rotates between them, giving each ready subscription a turn. Each additional child is another full Laravel process. Increase `consumer.processes` if subscription backlogs are not clearing quickly enough.

`idle_wait_milliseconds` controls how long an idle consumer may wait before checking again. Broker activity may wake it sooner. It is not a broker-request timeout and normally should remain `100`.

## Message Delivery

Spoolrail considers a broker delivery complete only after the selected Laravel queue accepts it. If the queue handoff fails while the transport remains usable, Spoolrail promptly releases the delivery for redelivery. If settlement is uncertain or the process stops first, broker recovery makes the delivery available again.

Spoolrail retains each successful queue handoff for the configured idempotency window. If an acknowledgment does not reach the broker and the broker redelivers the message during that window, Spoolrail acknowledges the redelivery without adding another Laravel job.

Once Laravel queue accepts the message, Laravel queue owns handler execution, retries, timeouts, and terminal failure.

Handoff idempotency uses locks from the Laravel cache store configured by `spoolrail.handoff_idempotency.cache_store`. Use a `database` or `redis` store in production because they provide atomic lock release and automatically clean up expired locks.

## Subscription Recovery

If one subscription stops, the others continue. Spoolrail restarts the affected subscription after 1, 5, 15, 30, then 60 seconds, and uses 60-second delays for further restarts. After the subscription has remained active for 60 seconds, the delay sequence resets and Spoolrail writes a recovery message at `notice` level, even if no messages arrived during that time.

Spoolrail reports subscription failures through Laravel's exception handler, including the original cause. By default, it reports each failure category at most once every five minutes. Change `exception_cooldown` in the consumer configuration shown above when another interval is needed.

## Deploying Consumers

Spoolrail consumers are long-lived and must restart after application code, declarations, or configuration change. After activating a new release on a server, run:

```bash
php artisan spoolrail:terminate
```

The command requests termination for every Spoolrail consumer on that server and returns immediately. The configured process monitor then starts them from the active release. Run the command on each server during a rolling deployment.

Each child stops starting receives and finishes only batches already returned before shutdown. A receive that returns afterward is released. The parent allows ten seconds for handoff and settlement before forcefully stopping an unresponsive child, leaving unsettled work to broker recovery.

`spoolrail:terminate` uses Laravel's default cache to reach running consumers. The deployment command and running consumers must use the same cache store and prefix so the termination request reaches them.

If a deployment changes the default cache store, prefix, or backing location, restart the existing consumers through the process monitor instead.

## Installing Supervisor

Supervisor monitors the long-lived root command and starts it again whenever it exits. On Ubuntu, install it with:

```bash
sudo apt-get install supervisor
```

Other operating systems may provide Supervisor through their own package manager.

## Supervisor Configuration

Create `/etc/supervisor/conf.d/spoolrail.conf` to start and monitor the default Spoolrail connection:

```ini
[program:spoolrail]
process_name=%(program_name)s
command=php /home/forge/example.com/artisan spoolrail
autostart=true
autorestart=true
user=forge
redirect_stderr=true
stdout_logfile=/home/forge/example.com/spoolrail.log
stopwaitsecs=30
killasgroup=true
```

The Artisan path must point to the active release.

## Starting Supervisor

After creating the configuration file, update Supervisor and start the process:

```bash
sudo supervisorctl reread

sudo supervisorctl update

sudo supervisorctl start spoolrail
```

These are initial provisioning commands. Ordinary deployments use only `php artisan spoolrail:terminate` after the active release changes.
