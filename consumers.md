# Running Consumers

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

Spoolrail hands each delivery to the subscription's configured Laravel Queue, where the message handler runs.

## Message Delivery

Spoolrail considers a broker delivery complete only after the selected Laravel Queue accepts it. If the Queue handoff fails or the consumer stops first, the message remains unacknowledged and the broker will redeliver it.

Spoolrail retains each successful Queue handoff for the configured idempotency window. If an acknowledgment does not reach the broker and the broker redelivers the message during that window, Spoolrail acknowledges the redelivery without adding another Laravel job.

Once Laravel Queue accepts the message, Laravel Queue owns handler execution, retries, timeouts, and terminal failure.

Handoff idempotency uses locks from the Laravel cache store configured by `spoolrail.handoff_idempotency.cache_store`. Use a `database` or `redis` store in production because they provide atomic lock release and automatically clean up expired locks.

## Subscription Recovery

If one subscription stops consuming unexpectedly, the others continue. Spoolrail restarts the affected subscription after 1, 5, 15, 30, then 60 seconds, and uses 60-second delays for further restarts. After the subscription has remained active for 60 seconds, the delay sequence resets and Spoolrail writes a recovery message at `notice` level, even if no messages arrived during that time.

Spoolrail reports subscription failures through Laravel's exception handler, including the original cause. Each subscription failure category is reported at most once every five minutes by default. Applications can change the cooldown in `config/spoolrail.php`:

```php
'consumer' => [
    'exception_cooldown' => 300,
],
```

## Deploying Consumers

Spoolrail consumers are long-lived and must restart after application code, declarations, or configuration change. After activating a new release on a server, run:

```bash
php artisan spoolrail:terminate
```

The command requests termination for every Spoolrail consumer on that server and returns immediately. The configured process monitor then starts them from the active release. Run the command on each server during a rolling deployment.

`spoolrail:terminate` uses Laravel's default cache to reach running consumers. The deployment command and running consumers must use the same cache store and prefix so the termination request reaches them.

If a deployment changes the default cache store, prefix, or backing location, restart the existing consumers through the process monitor instead.

## Installing Supervisor

Supervisor monitors the long-lived root command and starts it again whenever it exits. On Ubuntu, install it with:

```bash
sudo apt-get install supervisor
```

Other operating systems may provide Supervisor through their own package manager.

## Supervisor Configuration

Supervisor configuration files are typically stored in `/etc/supervisor/conf.d`. Create `/etc/supervisor/conf.d/spoolrail.conf` to start and monitor the default Spoolrail connection:

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
