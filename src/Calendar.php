<?php
// Calendar: determines whether a given date is a "workday" for streak purposes.
// Rules (in order of precedence):
//   1. calendar_overrides.kind = 'lab_closed' on that date  -> NOT a workday
//   2. calendar_overrides.kind = 'lab_open'   on that date  -> IS  a workday
//   3. Saturday or Sunday                                   -> NOT a workday
//   4. national_holidays has that date                      -> NOT a workday
//   5. otherwise                                            -> IS  a workday

declare(strict_types=1);

class Calendar {
    public static function isWorkday(PDO $pdo, string $date): bool {
        // 1+2: override?
        $st = $pdo->prepare('SELECT kind FROM calendar_overrides WHERE override_date=?');
        $st->execute([$date]);
        $kind = $st->fetchColumn();
        if ($kind === 'lab_closed') return false;
        if ($kind === 'lab_open')   return true;

        // 3: weekend?
        $dow = (int)(new DateTimeImmutable($date))->format('N'); // 1=Mon ... 7=Sun
        if ($dow === 6 || $dow === 7) return false;

        // 4: national holiday?
        $h = $pdo->prepare('SELECT 1 FROM national_holidays WHERE holiday_date=?');
        $h->execute([$date]);
        if ($h->fetchColumn()) return false;

        return true;
    }

    // Walk backwards from $date (exclusive) until a workday is found.
    // Safety cap: 60 days; returns null if none found in window (unrealistic).
    public static function previousWorkday(PDO $pdo, string $date): ?string {
        $d = new DateTimeImmutable($date);
        for ($i = 0; $i < 60; $i++) {
            $d = $d->modify('-1 day');
            $s = $d->format('Y-m-d');
            if (self::isWorkday($pdo, $s)) return $s;
        }
        return null;
    }

    // Sync national holidays from Cabinet Office CSV (Shift_JIS encoded).
    // Returns the number of holidays now in the table.
    public static function syncNationalHolidays(PDO $pdo): int {
        $url = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_USERAGENT => 'labpay/1.0',
        ]);
        $raw = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false || $code >= 400) {
            throw new ApiException('sync_failed', "fetch failed: $err (HTTP $code)", 502);
        }

        // The file is Shift_JIS. Convert to UTF-8 first.
        $utf8 = mb_convert_encoding($raw, 'UTF-8', 'SJIS-win,SJIS,UTF-8');
        $lines = preg_split("/\r?\n/", trim($utf8));
        if (count($lines) < 2) {
            throw new ApiException('sync_failed', 'CSV looks empty', 502);
        }

        // First line is header: "国民の祝日・休日月日,国民の祝日・休日名称"
        array_shift($lines);

        $insert = $pdo->prepare(
            'INSERT INTO national_holidays (holiday_date, name) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE name=VALUES(name), synced_at=CURRENT_TIMESTAMP'
        );

        $pdo->beginTransaction();
        try {
            // Replace strategy: clear & repopulate (CSV is the source of truth)
            $pdo->exec('DELETE FROM national_holidays');
            $count = 0;
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '') continue;
                $parts = str_getcsv($line);
                if (count($parts) < 2) continue;
                $date = trim($parts[0]);
                $name = trim($parts[1]);
                // CSV uses Y/M/D or Y-M-D; normalize
                $date = str_replace('/', '-', $date);
                if (!preg_match('/^\d{4}-\d{1,2}-\d{1,2}$/', $date)) continue;
                // Normalize zero-padding
                $dt = DateTimeImmutable::createFromFormat('Y-n-j', $date)
                   ?: DateTimeImmutable::createFromFormat('Y-m-d', $date);
                if (!$dt) continue;
                $insert->execute([$dt->format('Y-m-d'), mb_substr($name, 0, 100)]);
                $count++;
            }
            cfg_set($pdo, 'national_holidays_last_sync', date('Y-m-d H:i:s'));
            $pdo->commit();
            return $count;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    // Haversine distance in meters between two (lat, lng) points.
    public static function distanceMeters(float $lat1, float $lng1, float $lat2, float $lng2): float {
        $R = 6371000.0; // earth radius in meters
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
           + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $R * $c;
    }
}
