# SQL 코테 연습문제: 당근 숏폼 / 슈퍼센트

> 기준: BigQuery Standard SQL 스타일  
> 목적: 단순 집계가 아니라 드릴다운하면서 `집계 → 퍼널 → 리텐션 → 품질 → 마트 구조`로 내려가는 연습

---

## 공통 전제 스키마

### 당근 숏폼

- `video_events(user_id, video_id, creator_id, event_type, event_ts, watch_time_sec, session_id)`
- `videos(video_id, creator_id, category, created_at)`
- `users(user_id, signup_at, region)`
- `follows(user_id, creator_id, follow_ts)`
- `comments(comment_id, user_id, video_id, created_at)`
- `likes(user_id, video_id, created_at)`
- `shares(user_id, video_id, created_at)`

### 슈퍼센트

- `fact_events(event_ts, event_date, user_id, game_id, session_id, event_name, level_id, revenue, experiment_id, variant, install_date, platform, country, segment)`
- `dim_users(user_id, install_date, country, segment)`
- `dim_games(game_id, genre, studio)`
- `fact_purchases(order_id, user_id, game_id, purchase_ts, revenue)`

---

## 1) 당근 숏폼 SQL 코테 20문제

### 1. 일자별 조회 유저 수를 구하라
드릴다운: 7일 내 업로드된 영상만 대상으로, 같은 유저의 같은 날 중복 조회는 1회로 친다.

```sql
WITH target_videos AS (
  SELECT video_id
  FROM videos
  WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
)
SELECT
  DATE(e.event_ts) AS event_date,
  COUNT(DISTINCT e.user_id) AS viewers
FROM video_events e
JOIN target_videos v USING (video_id)
WHERE e.event_type = 'view'
GROUP BY 1
ORDER BY 1;
```

풀이 주석: `COUNT(DISTINCT user_id)`로 중복 조회를 제거한다. 먼저 대상 영상 범위를 줄인 뒤 집계해야 성능과 해석이 둘 다 깔끔하다.

---

### 2. 영상별 완주율을 구하라
드릴다운: 조회 유저 수와 완주 유저 수를 함께 구하고, 완주율까지 계산한다.

```sql
WITH base AS (
  SELECT
    video_id,
    COUNT(DISTINCT IF(event_type = 'view', user_id, NULL)) AS viewers,
    COUNT(DISTINCT IF(event_type = 'complete', user_id, NULL)) AS completers
  FROM video_events
  GROUP BY 1
)
SELECT
  video_id,
  viewers,
  completers,
  SAFE_DIVIDE(completers, viewers) AS complete_rate
FROM base
ORDER BY complete_rate DESC;
```

풀이 주석: 분모/분자를 한 번에 잡아야 퍼널 지표가 흔들리지 않는다. `SAFE_DIVIDE`는 0으로 나누는 문제를 막는다.

---

### 3. 조회 후 24시간 내 댓글 전환율을 구하라
드릴다운: 같은 영상에 대해 조회 후 댓글을 단 유저만 계산한다.

```sql
WITH views AS (
  SELECT user_id, video_id, MIN(event_ts) AS first_view_ts
  FROM video_events
  WHERE event_type = 'view'
  GROUP BY 1, 2
),
commenters AS (
  SELECT DISTINCT c.user_id, c.video_id
  FROM comments c
)
SELECT
  v.video_id,
  COUNT(DISTINCT v.user_id) AS viewed_users,
  COUNT(DISTINCT IF(c.user_id IS NOT NULL, v.user_id, NULL)) AS comment_users,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(c.user_id IS NOT NULL, v.user_id, NULL)),
    COUNT(DISTINCT v.user_id)
  ) AS comment_conversion
FROM views v
LEFT JOIN commenters c
  ON v.user_id = c.user_id
 AND v.video_id = c.video_id
GROUP BY 1
ORDER BY comment_conversion DESC;
```

풀이 주석: 실무에서는 "조회 후"를 엄밀히 보지만, 여기서는 구조 연습용으로 같은 영상 기준 전환을 계산한다. 시간 조건이 필요하면 `comments.created_at <= first_view_ts + INTERVAL 1 DAY`를 붙이면 된다.

---

### 4. 조회 후 제작자 팔로우 전환율을 구하라
드릴다운: 영상 조회 이후 같은 제작자를 팔로우한 유저 비율을 구한다.

```sql
WITH first_view AS (
  SELECT user_id, creator_id, MIN(event_ts) AS first_view_ts
  FROM video_events
  WHERE event_type = 'view'
  GROUP BY 1, 2
)
SELECT
  creator_id,
  COUNT(DISTINCT user_id) AS viewers,
  COUNT(DISTINCT IF(f.user_id IS NOT NULL, fv.user_id, NULL)) AS followers,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(f.user_id IS NOT NULL, fv.user_id, NULL)),
    COUNT(DISTINCT fv.user_id)
  ) AS follow_conversion
FROM first_view fv
LEFT JOIN follows f
  ON fv.user_id = f.user_id
 AND fv.creator_id = f.creator_id
GROUP BY 1
ORDER BY follow_conversion DESC;
```

풀이 주석: 숏폼은 `영상 단위`보다 `제작자 단위` 전환이 더 중요할 수 있다. 그래서 creator 기준 집계가 필요하다.

---

### 5. 첫 조회일 기준 D1/D7 재방문율을 구하라
드릴다운: 첫 조회한 날을 기준으로 다음날, 7일 뒤 다시 본 유저 비율을 계산한다.

```sql
WITH first_view_day AS (
  SELECT user_id, MIN(DATE(event_ts)) AS first_day
  FROM video_events
  WHERE event_type = 'view'
  GROUP BY 1
),
daily_view AS (
  SELECT DISTINCT user_id, DATE(event_ts) AS view_day
  FROM video_events
  WHERE event_type = 'view'
)
SELECT
  f.first_day,
  COUNT(DISTINCT f.user_id) AS cohort_users,
  COUNT(DISTINCT IF(d1.user_id IS NOT NULL, f.user_id, NULL)) AS d1_users,
  COUNT(DISTINCT IF(d7.user_id IS NOT NULL, f.user_id, NULL)) AS d7_users,
  SAFE_DIVIDE(COUNT(DISTINCT IF(d1.user_id IS NOT NULL, f.user_id, NULL)), COUNT(DISTINCT f.user_id)) AS d1_retention,
  SAFE_DIVIDE(COUNT(DISTINCT IF(d7.user_id IS NOT NULL, f.user_id, NULL)), COUNT(DISTINCT f.user_id)) AS d7_retention
FROM first_view_day f
LEFT JOIN daily_view d1
  ON f.user_id = d1.user_id AND d1.view_day = DATE_ADD(f.first_day, INTERVAL 1 DAY)
LEFT JOIN daily_view d7
  ON f.user_id = d7.user_id AND d7.view_day = DATE_ADD(f.first_day, INTERVAL 7 DAY)
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 리텐션은 반드시 코호트 기준이 필요하다. 첫 방문일을 기준으로 묶지 않으면 의미가 흐려진다.

---

### 6. 유저별 주간 활동일 수를 구하라
드릴다운: 각 유저가 한 주에 몇 일이나 숏폼을 봤는지 계산한다.

```sql
SELECT
  user_id,
  DATE_TRUNC(DATE(event_ts), WEEK(MONDAY)) AS week_start,
  COUNT(DISTINCT DATE(event_ts)) AS active_days
FROM video_events
WHERE event_type = 'view'
GROUP BY 1, 2
ORDER BY 2, 1;
```

풀이 주석: 주간 활성도는 세션 수보다 더 안정적인 반복 사용 신호일 수 있다.

---

### 7. 영상별 참여율을 구하라
드릴다운: 좋아요, 댓글, 공유를 모두 합친 참여율을 조회수 대비로 계산한다.

```sql
WITH views AS (
  SELECT video_id, COUNT(DISTINCT user_id) AS view_users
  FROM video_events
  WHERE event_type = 'view'
  GROUP BY 1
),
engagement AS (
  SELECT video_id, COUNT(DISTINCT user_id) AS engaged_users
  FROM (
    SELECT video_id, user_id FROM likes
    UNION DISTINCT
    SELECT video_id, user_id FROM comments
    UNION DISTINCT
    SELECT video_id, user_id FROM shares
  )
  GROUP BY 1
)
SELECT
  v.video_id,
  view_users,
  IFNULL(e.engaged_users, 0) AS engaged_users,
  SAFE_DIVIDE(IFNULL(e.engaged_users, 0), v.view_users) AS engagement_rate
FROM views v
LEFT JOIN engagement e USING (video_id)
ORDER BY engagement_rate DESC;
```

풀이 주석: 참여율은 이벤트를 합친 후 조회 대비로 봐야 한다. 이벤트를 따로 보면 해석이 산개한다.

---

### 8. 같은 영상을 2회 이상 본 유저 수를 구하라
드릴다운: 재시청 유저 수와 전체 조회 유저 수를 함께 비교한다.

```sql
WITH per_user_video AS (
  SELECT user_id, video_id, COUNT(*) AS view_cnt
  FROM video_events
  WHERE event_type = 'view'
  GROUP BY 1, 2
)
SELECT
  video_id,
  COUNT(DISTINCT user_id) AS viewers,
  COUNT(DISTINCT IF(view_cnt >= 2, user_id, NULL)) AS repeat_viewers
FROM per_user_video
GROUP BY 1
ORDER BY repeat_viewers DESC;
```

풀이 주석: 재시청은 숏폼에서 중요한 강한 반응 신호다. 단순 조회수보다 콘텐츠 흡인력을 더 잘 보여준다.

---

### 9. 조회만 하고 아무 반응도 없는 유저를 구하라
드릴다운: 좋아요/댓글/공유/팔로우를 한 번도 하지 않은 유저를 찾는다.

```sql
WITH viewed AS (
  SELECT DISTINCT user_id
  FROM video_events
  WHERE event_type = 'view'
),
reacted AS (
  SELECT DISTINCT user_id FROM likes
  UNION DISTINCT
  SELECT DISTINCT user_id FROM comments
  UNION DISTINCT
  SELECT DISTINCT user_id FROM shares
  UNION DISTINCT
  SELECT DISTINCT user_id FROM follows
)
SELECT v.user_id
FROM viewed v
LEFT JOIN reacted r USING (user_id)
WHERE r.user_id IS NULL;
```

풀이 주석: 이탈 분석의 출발점은 "본 사람 중 아무 행동도 안 한 사람"을 분리하는 것이다.

---

### 10. 가입 주차별 첫 7일 내 숏폼 시청률을 구하라
드릴다운: 가입 코호트별로 7일 안에 1회 이상 본 유저 비율을 구한다.

```sql
WITH cohort AS (
  SELECT user_id, DATE_TRUNC(DATE(signup_at), WEEK(MONDAY)) AS signup_week, DATE(signup_at) AS signup_day
  FROM users
),
first_7d_view AS (
  SELECT DISTINCT user_id
  FROM video_events
  WHERE event_type = 'view'
)
SELECT
  c.signup_week,
  COUNT(*) AS users,
  COUNT(DISTINCT IF(v.user_id IS NOT NULL, c.user_id, NULL)) AS viewers_7d,
  SAFE_DIVIDE(COUNT(DISTINCT IF(v.user_id IS NOT NULL, c.user_id, NULL)), COUNT(*)) AS view_rate_7d
FROM cohort c
LEFT JOIN first_7d_view v
  ON c.user_id = v.user_id
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 코호트는 가입 기준이든 첫 사용 기준이든 하나로 고정해야 한다.

---

### 11. 조회수는 높은데 완주율은 낮은 영상을 찾으라
드릴다운: 조회수 1000 이상, 완주율 하위 20%만 뽑는다.

```sql
WITH base AS (
  SELECT
    video_id,
    COUNTIF(event_type = 'view') AS views,
    COUNTIF(event_type = 'complete') AS completes
  FROM video_events
  GROUP BY 1
),
rates AS (
  SELECT *,
    SAFE_DIVIDE(completes, views) AS complete_rate
  FROM base
  WHERE views >= 1000
)
SELECT *
FROM rates
QUALIFY complete_rate <= APPROX_QUANTILES(complete_rate, 5)[OFFSET(1)];
```

풀이 주석: 운영에서는 "많이 본다"와 "끝까지 본다"를 분리해야 한다.

---

### 12. 제작자별 팔로워 증가분을 구하라
드릴다운: 영상 게시 후 7일 안에 팔로우가 얼마나 늘었는지 계산한다.

```sql
WITH first_post AS (
  SELECT creator_id, MIN(DATE(created_at)) AS first_post_day
  FROM videos
  GROUP BY 1
),
follow_7d AS (
  SELECT
    fp.creator_id,
    COUNT(DISTINCT f.user_id) AS followers_7d
  FROM first_post fp
  LEFT JOIN follows f
    ON fp.creator_id = f.creator_id
   AND DATE(f.follow_ts) BETWEEN fp.first_post_day AND DATE_ADD(fp.first_post_day, INTERVAL 7 DAY)
  GROUP BY 1
)
SELECT *
FROM follow_7d
ORDER BY followers_7d DESC;
```

풀이 주석: 제작자 성장 지표는 영상 성과를 제작자 단위로 연결할 때 유효하다.

---

### 13. 월별 유저 활성일 수를 구하라
드릴다운: 같은 달에 며칠이나 접속했는지 유저별로 계산한다.

```sql
SELECT
  user_id,
  DATE_TRUNC(DATE(event_ts), MONTH) AS month,
  COUNT(DISTINCT DATE(event_ts)) AS active_days
FROM video_events
WHERE event_type = 'view'
GROUP BY 1, 2
ORDER BY 2, 1;
```

풀이 주석: 월간 활성일은 단순 조회수보다 반복성 측면을 더 잘 보여준다.

---

### 14. 카테고리별 평균 시청시간과 완주율을 구하라
드릴다운: 각 카테고리의 평균 watch_time_sec와 완주율을 함께 계산한다.

```sql
WITH joined AS (
  SELECT
    e.video_id,
    v.category,
    e.user_id,
    e.event_type,
    e.watch_time_sec
  FROM video_events e
  JOIN videos v USING (video_id)
)
SELECT
  category,
  AVG(watch_time_sec) AS avg_watch_time,
  SAFE_DIVIDE(COUNTIF(event_type = 'complete'), COUNTIF(event_type = 'view')) AS complete_rate
FROM joined
GROUP BY 1
ORDER BY complete_rate DESC;
```

풀이 주석: 카테고리별로 "얼마나 오래 봤는가"와 "끝까지 봤는가"를 같이 봐야 한다.

---

### 15. view→like→comment→follow 퍼널을 구하라
드릴다운: 각 단계의 유저 수와 전환율을 함께 출력한다.

```sql
WITH view_users AS (
  SELECT DISTINCT user_id FROM video_events WHERE event_type = 'view'
),
like_users AS (
  SELECT DISTINCT user_id FROM likes
),
comment_users AS (
  SELECT DISTINCT user_id FROM comments
),
follow_users AS (
  SELECT DISTINCT user_id FROM follows
)
SELECT
  (SELECT COUNT(*) FROM view_users) AS view_users,
  (SELECT COUNT(*) FROM like_users) AS like_users,
  (SELECT COUNT(*) FROM comment_users) AS comment_users,
  (SELECT COUNT(*) FROM follow_users) AS follow_users,
  SAFE_DIVIDE((SELECT COUNT(*) FROM like_users), (SELECT COUNT(*) FROM view_users)) AS view_to_like,
  SAFE_DIVIDE((SELECT COUNT(*) FROM comment_users), (SELECT COUNT(*) FROM like_users)) AS like_to_comment,
  SAFE_DIVIDE((SELECT COUNT(*) FROM follow_users), (SELECT COUNT(*) FROM comment_users)) AS comment_to_follow;
```

풀이 주석: 퍼널은 단계별 절대 수와 전환율을 같이 써야 병목을 바로 볼 수 있다.

---

### 16. 공유율이 높은 영상 Top 10을 구하라
드릴다운: 조회수 대비 공유 비율로 랭킹한다.

```sql
WITH base AS (
  SELECT
    video_id,
    COUNTIF(event_type = 'view') AS views,
    COUNTIF(event_type = 'share') AS shares
  FROM video_events
  GROUP BY 1
)
SELECT
  video_id,
  views,
  shares,
  SAFE_DIVIDE(shares, views) AS share_rate
FROM base
WHERE views >= 100
ORDER BY share_rate DESC
LIMIT 10;
```

풀이 주석: 공유율은 확산성 강도를 보여준다. 조회수만으로는 숏폼 가치 판단이 안 된다.

---

### 17. 게시 후 1시간 내 반응이 가장 많은 영상은 무엇인가
드릴다운: 게시 후 1시간 이내 조회/좋아요/댓글 수를 합산한다.

```sql
WITH video_window AS (
  SELECT
    v.video_id,
    v.created_at,
    COUNTIF(e.event_type = 'view' AND e.event_ts BETWEEN v.created_at AND TIMESTAMP_ADD(v.created_at, INTERVAL 1 HOUR)) AS views_1h,
    COUNTIF(e.event_type = 'like' AND e.event_ts BETWEEN v.created_at AND TIMESTAMP_ADD(v.created_at, INTERVAL 1 HOUR)) AS likes_1h,
    COUNTIF(e.event_type = 'comment' AND e.event_ts BETWEEN v.created_at AND TIMESTAMP_ADD(v.created_at, INTERVAL 1 HOUR)) AS comments_1h
  FROM videos v
  LEFT JOIN video_events e USING (video_id)
  GROUP BY 1, 2
)
SELECT *,
  views_1h + likes_1h + comments_1h AS reaction_1h
FROM video_window
ORDER BY reaction_1h DESC;
```

풀이 주석: 운영에서는 초반 반응이 추천 확산과 연결되는 경우가 많아 1시간 윈도우가 유용하다.

---

### 18. 연속 3일 이상 시청한 유저를 구하라
드릴다운: 시청일을 날짜로 바꿔 streak를 판별한다.

```sql
WITH daily AS (
  SELECT DISTINCT user_id, DATE(event_ts) AS d
  FROM video_events
  WHERE event_type = 'view'
),
numbered AS (
  SELECT
    user_id,
    d,
    DATE_SUB(d, INTERVAL ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d) DAY) AS grp
  FROM daily
)
SELECT
  user_id,
  MAX(streak_len) AS max_streak
FROM (
  SELECT user_id, grp, COUNT(*) AS streak_len
  FROM numbered
  GROUP BY 1, 2
)
GROUP BY 1
HAVING MAX(streak_len) >= 3;
```

풀이 주석: 연속성은 리텐션의 질을 볼 때 중요하다. `date - row_number` 패턴을 외워두면 좋다.

---

### 19. 유저-영상별 최신 이벤트를 구하라
드릴다운: 같은 유저가 같은 영상을 여러 번 본 경우 가장 최근 이벤트 1건만 남긴다.

```sql
SELECT *
FROM video_events
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY user_id, video_id
  ORDER BY event_ts DESC
) = 1;
```

풀이 주석: 드릴다운에서 가장 많이 쓰는 패턴 중 하나가 최신 1건만 남기기다.

---

### 20. 카테고리별 종합 성과를 구하라
드릴다운: 조회수, 완주율, 참여율을 한 번에 본다.

```sql
WITH views AS (
  SELECT video_id, COUNT(DISTINCT user_id) AS view_users
  FROM video_events
  WHERE event_type = 'view'
  GROUP BY 1
),
complete AS (
  SELECT video_id, COUNT(DISTINCT user_id) AS complete_users
  FROM video_events
  WHERE event_type = 'complete'
  GROUP BY 1
),
engagement AS (
  SELECT video_id, COUNT(DISTINCT user_id) AS engaged_users
  FROM (
    SELECT video_id, user_id FROM likes
    UNION DISTINCT
    SELECT video_id, user_id FROM comments
    UNION DISTINCT
    SELECT video_id, user_id FROM shares
  )
  GROUP BY 1
)
SELECT
  v.category,
  SUM(IFNULL(vw.view_users, 0)) AS views,
  SAFE_DIVIDE(SUM(IFNULL(cp.complete_users, 0)), SUM(IFNULL(vw.view_users, 0))) AS complete_rate,
  SAFE_DIVIDE(SUM(IFNULL(en.engaged_users, 0)), SUM(IFNULL(vw.view_users, 0))) AS engagement_rate
FROM videos v
LEFT JOIN views vw USING (video_id)
LEFT JOIN complete cp USING (video_id)
LEFT JOIN engagement en USING (video_id)
GROUP BY 1
ORDER BY engagement_rate DESC;
```

풀이 주석: 최종적으로는 카테고리 단위로 "잘 보는지 / 끝까지 보는지 / 반응하는지"를 같이 봐야 한다.

---

## 2) 슈퍼센트 SQL 코테 20문제

### 1. 게임별 일자 DAU를 구하라
드릴다운: `event_name = 'session_start'`만 기준으로 각 게임의 일자별 활성 유저 수를 계산한다.

```sql
SELECT
  event_date,
  game_id,
  COUNT(DISTINCT user_id) AS dau
FROM fact_events
WHERE event_name = 'session_start'
GROUP BY 1, 2
ORDER BY 1, 2;
```

풀이 주석: 슈퍼센트는 게임 단위 분석이 기본이므로 `game_id`를 빠뜨리면 안 된다.

---

### 2. 게임별 세션 수와 유저당 평균 세션 수를 구하라
드릴다운: 일자별이 아니라 기간 전체 기준으로 계산한다.

```sql
WITH session_cnt AS (
  SELECT
    game_id,
    COUNT(DISTINCT session_id) AS sessions,
    COUNT(DISTINCT user_id) AS users
  FROM fact_events
  GROUP BY 1
)
SELECT
  game_id,
  sessions,
  users,
  SAFE_DIVIDE(sessions, users) AS sessions_per_user
FROM session_cnt
ORDER BY sessions_per_user DESC;
```

풀이 주석: 세션은 유저보다 더 빈도 높은 활동 단위라 평균 세션 수가 중요하다.

---

### 3. 필수 스키마 값 누락 이벤트를 찾으라
드릴다운: 특정 이벤트는 `level_id`와 `platform`이 반드시 있어야 한다고 가정한다.

```sql
SELECT *
FROM fact_events
WHERE event_name IN ('level_start', 'level_clear', 'purchase')
  AND (level_id IS NULL OR platform IS NULL);
```

풀이 주석: 데이터 품질은 분석보다 먼저 봐야 한다. 필수 필드 누락은 마트 신뢰도를 깨뜨린다.

---

### 4. 30분 기준 세션을 다시 나누어라
드릴다운: 유저별 이벤트 순서에서 30분 이상 끊기면 새 세션으로 본다.

```sql
WITH ordered AS (
  SELECT
    user_id,
    game_id,
    event_ts,
    LAG(event_ts) OVER (PARTITION BY user_id, game_id ORDER BY event_ts) AS prev_ts
  FROM fact_events
),
marked AS (
  SELECT
    *,
    SUM(
      CASE
        WHEN prev_ts IS NULL OR TIMESTAMP_DIFF(event_ts, prev_ts, MINUTE) > 30 THEN 1
        ELSE 0
      END
    ) OVER (PARTITION BY user_id, game_id ORDER BY event_ts) AS session_no
  FROM ordered
)
SELECT
  user_id,
  game_id,
  session_no,
  MIN(event_ts) AS session_start,
  MAX(event_ts) AS session_end
FROM marked
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

풀이 주석: 세션화는 `LAG`와 누적합 패턴으로 푼다. 실무 코테 단골이다.

---

### 5. 레벨 시작→클리어 전환율을 구하라
드릴다운: 각 게임별로 레벨 시작 유저 중 클리어 유저 비율을 계산한다.

```sql
WITH start_users AS (
  SELECT game_id, level_id, COUNT(DISTINCT user_id) AS start_users
  FROM fact_events
  WHERE event_name = 'level_start'
  GROUP BY 1, 2
),
clear_users AS (
  SELECT game_id, level_id, COUNT(DISTINCT user_id) AS clear_users
  FROM fact_events
  WHERE event_name = 'level_clear'
  GROUP BY 1, 2
)
SELECT
  s.game_id,
  s.level_id,
  s.start_users,
  IFNULL(c.clear_users, 0) AS clear_users,
  SAFE_DIVIDE(IFNULL(c.clear_users, 0), s.start_users) AS clear_rate
FROM start_users s
LEFT JOIN clear_users c
  ON s.game_id = c.game_id
 AND s.level_id = c.level_id
ORDER BY clear_rate DESC;
```

풀이 주석: 퍼널은 이벤트 이름이 곧 단계명이다. 시작과 완료를 분리해서 봐야 한다.

---

### 6. 일자별 게임 매출을 구하라
드릴다운: 구매 이벤트 기준으로 게임별 매출을 집계한다.

```sql
SELECT
  event_date,
  game_id,
  SUM(revenue) AS revenue
FROM fact_events
WHERE event_name = 'purchase'
GROUP BY 1, 2
ORDER BY 1, 2;
```

풀이 주석: 매출은 사실상 가장 기본적인 운영 지표다. 일자와 게임 기준이 기본 축이다.

---

### 7. ARPDAU를 구하라
드릴다운: 일자별 매출을 일자별 활성 유저 수로 나눈다.

```sql
WITH dau AS (
  SELECT event_date, game_id, COUNT(DISTINCT user_id) AS dau
  FROM fact_events
  WHERE event_name = 'session_start'
  GROUP BY 1, 2
),
rev AS (
  SELECT event_date, game_id, SUM(revenue) AS revenue
  FROM fact_events
  WHERE event_name = 'purchase'
  GROUP BY 1, 2
)
SELECT
  d.event_date,
  d.game_id,
  IFNULL(r.revenue, 0) AS revenue,
  d.dau,
  SAFE_DIVIDE(IFNULL(r.revenue, 0), d.dau) AS arp_dau
FROM dau d
LEFT JOIN rev r USING (event_date, game_id)
ORDER BY 1, 2;
```

풀이 주석: 슈퍼센트는 광고/게임 매출 분석이 섞일 수 있어 ARPDAU 같은 파생 지표를 자주 쓴다.

---

### 8. A/B 테스트에서 variant별 전환율을 비교하라
드릴다운: 각 버전의 구매 전환율을 비교한다.

```sql
WITH base AS (
  SELECT
    experiment_id,
    variant,
    COUNT(DISTINCT user_id) AS users,
    COUNT(DISTINCT IF(event_name = 'purchase', user_id, NULL)) AS buyers
  FROM fact_events
  WHERE experiment_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  experiment_id,
  variant,
  users,
  buyers,
  SAFE_DIVIDE(buyers, users) AS conversion_rate
FROM base
ORDER BY experiment_id, variant;
```

풀이 주석: 실험은 먼저 그룹별 표본 수를 봐야 한다. 전환율만 보면 안 된다.

---

### 9. 설치일 코호트 기준 D1/D7 리텐션을 구하라
드릴다운: 설치 후 1일, 7일에 다시 들어온 유저를 계산한다.

```sql
WITH cohort AS (
  SELECT user_id, MIN(install_date) AS install_day
  FROM dim_users
  GROUP BY 1
),
daily AS (
  SELECT DISTINCT user_id, event_date
  FROM fact_events
)
SELECT
  c.install_day,
  COUNT(*) AS cohort_users,
  COUNT(DISTINCT IF(d1.user_id IS NOT NULL, c.user_id, NULL)) AS d1_users,
  COUNT(DISTINCT IF(d7.user_id IS NOT NULL, c.user_id, NULL)) AS d7_users,
  SAFE_DIVIDE(COUNT(DISTINCT IF(d1.user_id IS NOT NULL, c.user_id, NULL)), COUNT(*)) AS d1_retention,
  SAFE_DIVIDE(COUNT(DISTINCT IF(d7.user_id IS NOT NULL, c.user_id, NULL)), COUNT(*)) AS d7_retention
FROM cohort c
LEFT JOIN daily d1
  ON c.user_id = d1.user_id AND d1.event_date = DATE_ADD(c.install_day, INTERVAL 1 DAY)
LEFT JOIN daily d7
  ON c.user_id = d7.user_id AND d7.event_date = DATE_ADD(c.install_day, INTERVAL 7 DAY)
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 게임/앱 리텐션은 설치 코호트가 가장 표준적인 기준이다.

---

### 10. 세그먼트별 매출 상위를 구하라
드릴다운: 유저 세그먼트별로 매출을 합산한다.

```sql
SELECT
  segment,
  SUM(revenue) AS revenue
FROM fact_events
WHERE event_name = 'purchase'
GROUP BY 1
ORDER BY revenue DESC;
```

풀이 주석: 슈퍼센트는 게임/국가/세그먼트 기준으로 쪼개 보는 것이 중요하다.

---

### 11. 이상치 이벤트를 찾으라
드릴다운: 음수 매출, 비정상 시간, 비정상 세션을 포함한 이벤트를 찾는다.

```sql
SELECT *
FROM fact_events
WHERE revenue < 0
   OR event_ts IS NULL
   OR session_id IS NULL;
```

풀이 주석: 품질 체크는 분석 마트의 전제다. 이상치 필터링은 가장 먼저 해야 한다.

---

### 12. 일 단위 마트 테이블을 만든다고 가정하고 요약 쿼리를 써라
드릴다운: raw event를 `daily_fact`로 바꾸는 집계 쿼리다.

```sql
SELECT
  event_date,
  game_id,
  COUNT(DISTINCT user_id) AS dau,
  COUNT(DISTINCT session_id) AS sessions,
  COUNTIF(event_name = 'purchase') AS purchases,
  SUM(CASE WHEN event_name = 'purchase' THEN revenue ELSE 0 END) AS revenue
FROM fact_events
GROUP BY 1, 2
ORDER BY 1, 2;
```

풀이 주석: 마트는 원천 이벤트를 바로 써도 되지만, 보통 일 단위 요약 테이블이 먼저 필요하다.

---

### 13. 유저/게임 차원을 붙여 분석 테이블을 만들어라
드릴다운: fact_events에 dim_users, dim_games를 조인한다.

```sql
SELECT
  f.event_date,
  f.user_id,
  u.country,
  u.segment,
  f.game_id,
  g.genre,
  g.studio,
  f.event_name,
  f.revenue
FROM fact_events f
LEFT JOIN dim_users u USING (user_id)
LEFT JOIN dim_games g USING (game_id);
```

풀이 주석: Fact/Dimension 구조를 이해하는지 보는 전형적인 문제다.

---

### 14. DAU와 WAU를 함께 구하라
드릴다운: 일자별 DAU와 7일 롤링 WAU를 계산한다.

```sql
WITH daily_users AS (
  SELECT DISTINCT event_date, game_id, user_id
  FROM fact_events
  WHERE event_name = 'session_start'
),
calendar AS (
  SELECT DISTINCT event_date, game_id
  FROM fact_events
)
SELECT
  c.event_date,
  c.game_id,
  COUNT(DISTINCT d.user_id) AS wau
FROM calendar c
LEFT JOIN daily_users d
  ON c.game_id = d.game_id
 AND d.event_date BETWEEN DATE_SUB(c.event_date, INTERVAL 6 DAY) AND c.event_date
GROUP BY 1, 2
ORDER BY 1, 2;
```

풀이 주석: WAU는 최근 7일 유저를 묶는 개념이라 날짜 범위 조인이 필요하다.

---

### 15. 중복 이벤트를 제거하고 최신 1건만 남겨라
드릴다운: 같은 유저, 같은 게임, 같은 이벤트명에서 가장 최신 기록만 남긴다.

```sql
SELECT *
FROM fact_events
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY user_id, game_id, event_name, level_id
  ORDER BY event_ts DESC
) = 1;
```

풀이 주석: 이벤트 중복 제거는 데이터 품질 관리의 기본이다.

---

### 16. 유저 수준 feature table을 만들어라
드릴다운: 세션 수, 구매 횟수, 총 매출을 유저 단위로 만든다.

```sql
SELECT
  user_id,
  COUNT(DISTINCT session_id) AS sessions,
  COUNTIF(event_name = 'purchase') AS purchases,
  SUM(CASE WHEN event_name = 'purchase' THEN revenue ELSE 0 END) AS revenue,
  COUNTIF(event_name = 'ad_impression') AS ad_impressions
FROM fact_events
GROUP BY 1;
```

풀이 주석: 분석가가 재사용할 수 있는 feature table 감각을 보는 문제다.

---

### 17. 같은 유저가 같은 이벤트를 같은 시각에 중복 발생시킨 건을 찾으라
드릴다운: 중복 로그 품질 문제를 찾는다.

```sql
SELECT
  user_id,
  game_id,
  event_name,
  event_ts,
  COUNT(*) AS dup_cnt
FROM fact_events
GROUP BY 1, 2, 3, 4
HAVING COUNT(*) > 1;
```

풀이 주석: 중복 이벤트는 실험/대시보드 모두를 망친다. 품질 문제를 먼저 찾는 태도가 중요하다.

---

### 18. view→tutorial_complete→purchase 퍼널을 구하라
드릴다운: 게임 튜토리얼 흐름의 전환율을 계산한다.

```sql
WITH view_u AS (
  SELECT DISTINCT user_id, game_id
  FROM fact_events
  WHERE event_name = 'session_start'
),
tutorial_u AS (
  SELECT DISTINCT user_id, game_id
  FROM fact_events
  WHERE event_name = 'tutorial_complete'
),
purchase_u AS (
  SELECT DISTINCT user_id, game_id
  FROM fact_events
  WHERE event_name = 'purchase'
)
SELECT
  v.game_id,
  COUNT(*) AS view_users,
  COUNT(DISTINCT t.user_id) AS tutorial_users,
  COUNT(DISTINCT p.user_id) AS purchase_users,
  SAFE_DIVIDE(COUNT(DISTINCT t.user_id), COUNT(*)) AS view_to_tutorial,
  SAFE_DIVIDE(COUNT(DISTINCT p.user_id), COUNT(DISTINCT t.user_id)) AS tutorial_to_purchase
FROM view_u v
LEFT JOIN tutorial_u t USING (user_id, game_id)
LEFT JOIN purchase_u p USING (user_id, game_id)
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 게임 퍼널은 입장→학습→과금 흐름이 중요해서 튜토리얼 구간이 핵심이다.

---

### 19. 실험군/대조군의 국가/세그먼트 균형을 확인하라
드릴다운: assignment가 랜덤했는지 먼저 본다.

```sql
SELECT
  experiment_id,
  variant,
  country,
  segment,
  COUNT(DISTINCT user_id) AS users
FROM fact_events
WHERE experiment_id IS NOT NULL
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;
```

풀이 주석: 실험은 결과보다 먼저 그룹 균형을 봐야 한다. 이걸 안 보면 해석이 흔들린다.

---

### 20. 게임별 핵심 성과를 한 번에 요약하라
드릴다운: DAU, 세션, 매출, 구매자 수를 한 표로 만든다.

```sql
WITH dau AS (
  SELECT event_date, game_id, COUNT(DISTINCT user_id) AS dau
  FROM fact_events
  WHERE event_name = 'session_start'
  GROUP BY 1, 2
),
session_cnt AS (
  SELECT event_date, game_id, COUNT(DISTINCT session_id) AS sessions
  FROM fact_events
  GROUP BY 1, 2
),
rev AS (
  SELECT event_date, game_id, SUM(revenue) AS revenue, COUNT(DISTINCT IF(event_name = 'purchase', user_id, NULL)) AS buyers
  FROM fact_events
  GROUP BY 1, 2
)
SELECT
  d.event_date,
  d.game_id,
  d.dau,
  s.sessions,
  r.buyers,
  r.revenue,
  SAFE_DIVIDE(r.revenue, d.dau) AS arp_dau
FROM dau d
LEFT JOIN session_cnt s USING (event_date, game_id)
LEFT JOIN rev r USING (event_date, game_id)
ORDER BY 1, 2;
```

풀이 주석: 실무에서는 단일 지표보다 요약 테이블이 중요하다. 한 표로 운영 판단이 가능해야 한다.

---

## 공부 순서

1. `COUNT DISTINCT` / `CASE WHEN` / `SAFE_DIVIDE`
2. `ROW_NUMBER` / `LAG` / 세션화
3. 퍼널 (`view → action → conversion`)
4. 리텐션 (`cohort → D1/D7`)
5. 마트 (`fact/dim`, 요약 테이블)
6. 품질 (`중복`, `누락`, `이상치`)

## 외우면 좋은 패턴

- 최신 1건: `ROW_NUMBER() OVER (...) = 1`
- 세션화: `LAG + TIMESTAMP_DIFF + 누적합`
- 퍼널: 단계별 distinct user 집계
- 리텐션: 코호트 기준 날짜 이동
- 품질 체크: `WHERE null`, `HAVING count(*) > 1`

---

## 3) 초보-중간 SQL 코테 20문제

### 초보-중간

- `events(user_id, event_name, event_ts, session_id, platform, country, item_id)`
- `users(user_id, signup_at, country, age_group)`
- `sessions(session_id, user_id, start_ts, end_ts, platform)`
- `orders(order_id, user_id, order_ts, status, amount, country, platform)`
- `payments(payment_id, order_id, paid_ts, payment_method, payment_status, amount)`
- `products(item_id, category, price, created_at)`
- `cart_items(user_id, item_id, added_at, quantity)`
- `order_items(order_id, item_id, quantity, unit_price)`

### 1. 일자별 앱 실행 유저 수를 구하라
드릴다운: `app_open` 이벤트만 보고, 같은 유저의 같은 날 중복은 1회로 친다.

```sql
SELECT
  DATE(event_ts) AS event_date,
  COUNT(DISTINCT user_id) AS active_users
FROM events
WHERE event_name = 'app_open'
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 가장 기본적인 일자별 활성 사용자 집계다. `COUNT(DISTINCT user_id)`로 중복을 제거한다.

---

### 2. 일자별 가입자 수와 누적 가입자 수를 구하라
드릴다운: 일자별 신규 가입자 수와 그 누적합을 함께 보여준다.

```sql
WITH daily_signup AS (
  SELECT
    DATE(signup_at) AS signup_date,
    COUNT(*) AS signups
  FROM users
  GROUP BY 1
)
SELECT
  signup_date,
  signups,
  SUM(signups) OVER (ORDER BY signup_date) AS cumulative_signups
FROM daily_signup
ORDER BY 1;
```

풀이 주석: 일자별 집계 뒤에 윈도우 함수로 누적합을 붙인다. 이런 형태가 가장 자주 나온다.

---

### 3. 일자별 가입 국가 1위를 구하라
드릴다운: 같은 날짜 안에서 가입자 수가 가장 많은 국가 1개만 남긴다.

```sql
WITH daily_country AS (
  SELECT
    DATE(signup_at) AS signup_date,
    country,
    COUNT(*) AS signups
  FROM users
  GROUP BY 1, 2
)
SELECT
  signup_date,
  country,
  signups
FROM daily_country
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY signup_date
  ORDER BY signups DESC, country
) = 1
ORDER BY 1;
```

풀이 주석: `ROW_NUMBER()`로 1등만 남기는 패턴이다. `QUALIFY`는 윈도우 함수 결과를 바로 거를 때 유용하다.

---

### 4. 플랫폼별 평균 세션 길이를 구하라
드릴다운: 종료 시각이 있는 세션만 보고 분 단위 평균을 계산한다.

```sql
SELECT
  platform,
  AVG(TIMESTAMP_DIFF(end_ts, start_ts, MINUTE)) AS avg_session_min
FROM sessions
WHERE end_ts IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC;
```

풀이 주석: 세션 길이는 시작과 끝 시각 차이로 구한다. 초보자가 자주 틀리는 부분은 단위를 먼저 정하지 않는 것이다.

---

### 5. 세션별 평균 이벤트 수를 구하라
드릴다운: 세션 하나에 이벤트가 평균 몇 번 발생하는지 본다.

```sql
WITH per_session AS (
  SELECT
    session_id,
    COUNT(*) AS event_cnt
  FROM events
  GROUP BY 1
)
SELECT
  AVG(event_cnt) AS avg_events_per_session
FROM per_session;
```

풀이 주석: 먼저 세션 단위로 묶고, 그다음 평균을 본다. 집계 단위가 2단계로 내려가는 전형적인 문제다.

---

### 6. 회원가입 후 첫 구매까지 걸린 평균 일수를 구하라
드릴다운: 첫 구매만 기준으로 가입일 대비 몇 일 뒤인지 본다.

```sql
WITH first_purchase AS (
  SELECT
    user_id,
    MIN(DATE(order_ts)) AS first_purchase_date
  FROM orders
  WHERE status = 'completed'
  GROUP BY 1
)
SELECT
  AVG(DATE_DIFF(fp.first_purchase_date, DATE(u.signup_at), DAY)) AS avg_days_to_first_purchase
FROM users u
JOIN first_purchase fp USING (user_id);
```

풀이 주석: 가입일과 첫 구매일의 차이를 계산하면 전환 속도를 볼 수 있다. `DATE_DIFF`를 익히는 좋은 연습이다.

---

### 7. 가입 후 3일 이내 첫 구매 전환율을 국가별로 구하라
드릴다운: 가입한 유저 중 3일 안에 첫 구매를 한 비율을 본다.

```sql
WITH first_purchase AS (
  SELECT
    user_id,
    MIN(DATE(order_ts)) AS first_purchase_date
  FROM orders
  WHERE status = 'completed'
  GROUP BY 1
)
SELECT
  u.country,
  COUNT(DISTINCT u.user_id) AS signups,
  COUNT(DISTINCT IF(
    fp.first_purchase_date IS NOT NULL
    AND DATE_DIFF(fp.first_purchase_date, DATE(u.signup_at), DAY) BETWEEN 0 AND 3,
    u.user_id,
    NULL
  )) AS buyers_3d,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(
      fp.first_purchase_date IS NOT NULL
      AND DATE_DIFF(fp.first_purchase_date, DATE(u.signup_at), DAY) BETWEEN 0 AND 3,
      u.user_id,
      NULL
    )),
    COUNT(DISTINCT u.user_id)
  ) AS conversion_3d
FROM users u
LEFT JOIN first_purchase fp USING (user_id)
GROUP BY 1
ORDER BY 4 DESC;
```

풀이 주석: 전환율은 조건을 한 번 더 걸어야 의미가 정확해진다. 가입일 기준 3일 윈도우를 명확히 잡는 것이 핵심이다.

---

### 8. 카테고리별 상품 수와 평균 가격을 구하라
드릴다운: 상품 카테고리별로 몇 개가 있고 평균 가격이 얼마인지 본다.

```sql
SELECT
  category,
  COUNT(*) AS products,
  AVG(price) AS avg_price
FROM products
GROUP BY 1
ORDER BY 2 DESC;
```

풀이 주석: 차분한 기본 집계 문제다. `COUNT(*)`와 `AVG()`를 함께 익히기에 좋다.

---

### 9. 일자별 주문 수, 취소 수, 취소율을 구하라
드릴다운: 주문 흐름에서 취소 비중이 얼마나 되는지 본다.

```sql
SELECT
  DATE(order_ts) AS order_date,
  COUNT(*) AS orders,
  COUNTIF(status = 'canceled') AS canceled_orders,
  SAFE_DIVIDE(COUNTIF(status = 'canceled'), COUNT(*)) AS cancel_rate
FROM orders
GROUP BY 1
ORDER BY 1;
```

풀이 주석: `COUNTIF`는 조건부 카운트에 바로 쓴다. 취소율은 분모를 전체 주문으로 두는 것이 자연스럽다.

---

### 10. 결제 완료 주문 비율을 플랫폼별로 구하라
드릴다운: 주문 중 실제 결제 완료된 주문의 비율을 본다.

```sql
WITH payment_status AS (
  SELECT
    o.order_id,
    o.platform,
    MAX(IF(p.payment_status = 'completed', 1, 0)) AS paid_flag
  FROM orders o
  LEFT JOIN payments p
    ON o.order_id = p.order_id
  GROUP BY 1, 2
)
SELECT
  platform,
  COUNT(*) AS orders,
  COUNTIF(paid_flag = 1) AS paid_orders,
  SAFE_DIVIDE(COUNTIF(paid_flag = 1), COUNT(*)) AS paid_rate
FROM payment_status
GROUP BY 1
ORDER BY 4 DESC;
```

풀이 주석: 주문과 결제를 분리해서 본다. 실무에서는 같은 주문이 여러 결제 시도를 가질 수 있어 이렇게 정리하는 습관이 중요하다.

---

### 11. 상품 카테고리별 조회 → 장바구니 전환율을 구하라
드릴다운: 같은 상품을 본 유저 중 장바구니에 담은 비율을 계산한다.

```sql
WITH views AS (
  SELECT DISTINCT user_id, item_id
  FROM events
  WHERE event_name = 'view_item'
    AND item_id IS NOT NULL
),
carts AS (
  SELECT DISTINCT user_id, item_id
  FROM events
  WHERE event_name = 'add_to_cart'
    AND item_id IS NOT NULL
)
SELECT
  p.category,
  COUNT(DISTINCT v.user_id) AS viewers,
  COUNT(DISTINCT IF(c.user_id IS NOT NULL, v.user_id, NULL)) AS cart_users,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(c.user_id IS NOT NULL, v.user_id, NULL)),
    COUNT(DISTINCT v.user_id)
  ) AS view_to_cart_rate
FROM views v
JOIN products p USING (item_id)
LEFT JOIN carts c
  ON v.user_id = c.user_id
 AND v.item_id = c.item_id
GROUP BY 1
ORDER BY 4 DESC;
```

풀이 주석: 이벤트 전환은 유저와 아이템 둘 다 맞춰서 봐야 한다. 그냥 유저만 맞추면 전환이 부풀 수 있다.

---

### 12. 장바구니에 담고도 구매하지 않은 유저 수를 구하라
드릴다운: 담기와 구매를 비교해서 이탈 유저를 찾는다.

```sql
WITH cart_users AS (
  SELECT DISTINCT user_id, item_id
  FROM events
  WHERE event_name = 'add_to_cart'
),
purchase_users AS (
  SELECT DISTINCT user_id, item_id
  FROM events
  WHERE event_name = 'purchase'
)
SELECT
  COUNT(DISTINCT cu.user_id) AS cart_users,
  COUNT(DISTINCT IF(pu.user_id IS NULL, cu.user_id, NULL)) AS abandoners
FROM cart_users cu
LEFT JOIN purchase_users pu
  ON cu.user_id = pu.user_id
 AND cu.item_id = pu.item_id;
```

풀이 주석: 이탈 분석은 먼저 "담았지만 안 산 사람"을 뽑는 것에서 시작한다. 그다음 이유를 파면 된다.

---

### 13. 상품별 매출 상위 5개를 구하라
드릴다운: 주문 상품 기준으로 매출이 가장 큰 상품 5개를 구한다.

```sql
SELECT
  oi.item_id,
  p.category,
  SUM(oi.quantity * oi.unit_price) AS revenue
FROM order_items oi
JOIN products p USING (item_id)
GROUP BY 1, 2
ORDER BY revenue DESC
LIMIT 5;
```

풀이 주석: 매출은 수량과 단가를 곱한 뒤 합산한다. `LIMIT`으로 상위 몇 개만 보는 패턴을 익힌다.

---

### 14. 유저별 첫 주문일과 마지막 주문일, 기간 차이를 구하라
드릴다운: 첫 구매 후 얼마나 오래 계속 샀는지 본다.

```sql
WITH user_orders AS (
  SELECT
    user_id,
    MIN(DATE(order_ts)) AS first_order_date,
    MAX(DATE(order_ts)) AS last_order_date
  FROM orders
  WHERE status = 'completed'
  GROUP BY 1
)
SELECT
  user_id,
  first_order_date,
  last_order_date,
  DATE_DIFF(last_order_date, first_order_date, DAY) AS span_days
FROM user_orders
ORDER BY span_days DESC;
```

풀이 주석: 첫 주문과 마지막 주문 사이의 간격은 재구매 성향을 보기 좋은 기초 지표다.

---

### 15. 가입 후 7일 안에 아무 행동도 하지 않은 유저를 구하라
드릴다운: 가입했지만 이벤트가 없는 유저를 찾는다.

```sql
WITH active_7d AS (
  SELECT DISTINCT u.user_id
  FROM users u
  JOIN events e
    ON u.user_id = e.user_id
  WHERE DATE(e.event_ts) BETWEEN DATE(u.signup_at)
    AND DATE_ADD(DATE(u.signup_at), INTERVAL 7 DAY)
)
SELECT
  u.user_id
FROM users u
LEFT JOIN active_7d a USING (user_id)
WHERE a.user_id IS NULL
ORDER BY 1;
```

풀이 주석: 가입자 대비 실제 활동자를 분리하는 문제다. `LEFT JOIN ... IS NULL` 패턴을 연습하기 좋다.

---

### 16. 요일별 구매 건수와 매출을 구하라
드릴다운: 어떤 요일에 주문과 매출이 몰리는지 본다.

```sql
SELECT
  EXTRACT(DAYOFWEEK FROM DATE(order_ts)) AS day_of_week,
  COUNT(*) AS orders,
  SUM(amount) AS revenue
FROM orders
WHERE status = 'completed'
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 날짜에서 요일을 뽑아내는 `EXTRACT`를 익히는 문제다. 요일별 패턴은 운영에서 자주 본다.

---

### 17. 일자별 구매 건수 전일 대비 증감을 구하라
드릴다운: 전날과 비교해 주문 수가 얼마나 늘거나 줄었는지 본다.

```sql
WITH daily_orders AS (
  SELECT
    DATE(order_ts) AS order_date,
    COUNT(*) AS orders
  FROM orders
  WHERE status = 'completed'
  GROUP BY 1
)
SELECT
  order_date,
  orders,
  LAG(orders) OVER (ORDER BY order_date) AS prev_orders,
  orders - LAG(orders) OVER (ORDER BY order_date) AS diff_orders
FROM daily_orders
ORDER BY 1;
```

풀이 주석: `LAG`는 바로 이전 값을 붙이는 데 가장 많이 쓴다. 증감 계산은 입문자가 윈도우 함수를 익히기 좋다.

---

### 18. 반복 구매 유저 수와 반복 구매율을 구하라
드릴다운: completed 주문을 2번 이상 한 유저를 찾는다.

```sql
WITH user_purchase AS (
  SELECT
    user_id,
    COUNT(*) AS purchase_cnt
  FROM orders
  WHERE status = 'completed'
  GROUP BY 1
)
SELECT
  COUNT(*) AS purchasers,
  COUNTIF(purchase_cnt >= 2) AS repeat_purchasers,
  SAFE_DIVIDE(COUNTIF(purchase_cnt >= 2), COUNT(*)) AS repeat_rate
FROM user_purchase;
```

풀이 주석: 단순 구매자 수보다 반복 구매 비율이 더 중요할 때가 많다. `COUNTIF`로 조건부 비율을 계산한다.

---

### 19. 결제 완료가 24시간 안에 잡히지 않은 주문을 찾으라
드릴다운: 주문은 있었는데 결제 완료가 늦거나 없는 주문을 찾는다.

```sql
WITH order_payment AS (
  SELECT
    o.order_id,
    o.user_id,
    o.order_ts,
    MIN(IF(p.payment_status = 'completed', p.paid_ts, NULL)) AS paid_ts
  FROM orders o
  LEFT JOIN payments p
    ON o.order_id = p.order_id
  GROUP BY 1, 2, 3
)
SELECT
  order_id,
  user_id,
  order_ts,
  paid_ts
FROM order_payment
WHERE paid_ts IS NULL
   OR TIMESTAMP_DIFF(paid_ts, order_ts, HOUR) > 24
ORDER BY order_ts;
```

풀이 주석: 운영에서 자주 보는 품질/정산 문제다. "있어야 할 결제가 없다"를 찾는 습관이 중요하다.

---

### 20. 일자별 퍼널을 한 번에 요약하라
드릴다운: `app_open → view_item → add_to_cart → purchase`를 일자별로 한 번에 본다.

```sql
SELECT
  DATE(event_ts) AS event_date,
  COUNT(DISTINCT IF(event_name = 'app_open', user_id, NULL)) AS open_users,
  COUNT(DISTINCT IF(event_name = 'view_item', user_id, NULL)) AS view_users,
  COUNT(DISTINCT IF(event_name = 'add_to_cart', user_id, NULL)) AS cart_users,
  COUNT(DISTINCT IF(event_name = 'purchase', user_id, NULL)) AS purchase_users,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(event_name = 'view_item', user_id, NULL)),
    COUNT(DISTINCT IF(event_name = 'app_open', user_id, NULL))
  ) AS open_to_view_rate,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(event_name = 'add_to_cart', user_id, NULL)),
    COUNT(DISTINCT IF(event_name = 'view_item', user_id, NULL))
  ) AS view_to_cart_rate,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(event_name = 'purchase', user_id, NULL)),
    COUNT(DISTINCT IF(event_name = 'add_to_cart', user_id, NULL))
  ) AS cart_to_purchase_rate
FROM events
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 입문용이지만 가장 실전적인 퍼널 문제다. 단일 전환율보다 단계별 전환율을 같이 봐야 병목이 보인다.

---

## 4) 초보 SQL 코테 20문제

### 초보

- `users(user_id, signup_at, country, age_group)`
- `orders(order_id, user_id, order_ts, status, amount)`
- `page_views(view_id, user_id, page_name, view_ts, device)`
- `products(product_id, category, price, created_at)`

### 1. 일자별 가입자 수를 구하라
드릴다운: 같은 날 가입한 유저 수를 일자별로 본다.

```sql
SELECT
  DATE(signup_at) AS signup_date,
  COUNT(*) AS signups
FROM users
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 가장 기본적인 날짜별 집계다. 먼저 `DATE()`로 날짜만 뽑는 습관을 익힌다.

---

### 2. 국가별 가입자 수를 구하라
드릴다운: 어떤 국가의 가입자가 많은지 본다.

```sql
SELECT
  country,
  COUNT(*) AS signups
FROM users
GROUP BY 1
ORDER BY 2 DESC;
```

풀이 주석: `GROUP BY`와 `ORDER BY`만으로도 기본적인 운영 지표를 만들 수 있다.

---

### 3. 연령대별 가입자 수를 구하라
드릴다운: `age_group` 별로 몇 명이 가입했는지 계산한다.

```sql
SELECT
  age_group,
  COUNT(*) AS signups
FROM users
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 문자열 카테고리 집계는 초보 단계에서 가장 많이 나온다.

---

### 4. 일자별 주문 수를 구하라
드릴다운: 주문이 언제 많이 발생했는지 본다.

```sql
SELECT
  DATE(order_ts) AS order_date,
  COUNT(*) AS orders
FROM orders
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 가입자 집계와 거의 같은 패턴이다. 테이블만 바뀌었는지 확인하면 된다.

---

### 5. 상태별 주문 수를 구하라
드릴다운: completed, canceled, pending 주문 수를 각각 센다.

```sql
SELECT
  status,
  COUNT(*) AS orders
FROM orders
GROUP BY 1
ORDER BY 2 DESC;
```

풀이 주석: 상태값 집계는 운영에서 매우 자주 보인다. 상태를 그대로 세는 연습을 한다.

---

### 6. 완료 주문의 평균 금액을 구하라
드릴다운: 결제 완료된 주문만 평균 금액을 계산한다.

```sql
SELECT
  AVG(amount) AS avg_amount
FROM orders
WHERE status = 'completed';
```

풀이 주석: `WHERE`로 먼저 걸러낸 뒤 평균을 보는 가장 기본적인 패턴이다.

---

### 7. 일자별 매출을 구하라
드릴다운: 완료 주문의 일자별 매출을 합산한다.

```sql
SELECT
  DATE(order_ts) AS order_date,
  SUM(amount) AS revenue
FROM orders
WHERE status = 'completed'
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 매출은 `SUM(amount)`로 구한다. 주문 수와 매출은 다르다는 점을 구분해야 한다.

---

### 8. 최근 7일 가입자 수를 구하라
드릴다운: 오늘 기준 최근 7일에 가입한 유저만 센다.

```sql
SELECT
  COUNT(*) AS signups_7d
FROM users
WHERE DATE(signup_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY);
```

풀이 주석: 기간 조건은 `DATE_SUB`로 많이 푼다. 최근 범위를 잘 자르는 연습이다.

---

### 9. 일자별 조회 수를 구하라
드릴다운: `page_views`에서 하루에 몇 번 열람했는지 본다.

```sql
SELECT
  DATE(view_ts) AS view_date,
  COUNT(*) AS views
FROM page_views
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 조회 수는 가장 흔한 지표다. 이벤트 수는 `COUNT(*)`로 바로 셀 수 있다.

---

### 10. 페이지별 조회 수를 구하라
드릴다운: 어떤 페이지를 가장 많이 보는지 확인한다.

```sql
SELECT
  page_name,
  COUNT(*) AS views
FROM page_views
GROUP BY 1
ORDER BY 2 DESC;
```

풀이 주석: 페이지 단위 집계도 초보자가 자주 만나는 기본 문제다.

---

### 11. 페이지별 순 방문자 수를 구하라
드릴다운: 같은 사람이 여러 번 봐도 1명으로 센다.

```sql
SELECT
  page_name,
  COUNT(DISTINCT user_id) AS unique_users
FROM page_views
GROUP BY 1
ORDER BY 2 DESC;
```

풀이 주석: `COUNT(DISTINCT)`는 중복 제거의 출발점이다. 조회 수와 방문자 수를 구분해야 한다.

---

### 12. 주문이 한 번도 없는 유저 수를 구하라
드릴다운: 가입자는 있는데 주문은 없는 유저를 찾는다.

```sql
SELECT
  COUNT(*) AS no_order_users
FROM users u
LEFT JOIN orders o
  ON u.user_id = o.user_id
WHERE o.user_id IS NULL;
```

풀이 주석: `LEFT JOIN`과 `IS NULL`은 미구매/미활동 유저를 찾을 때 가장 많이 쓴다.

---

### 13. 국가별 주문 수를 구하라
드릴다운: 유저 테이블과 주문 테이블을 붙여 국가별 주문 수를 계산한다.

```sql
SELECT
  u.country,
  COUNT(*) AS orders
FROM orders o
JOIN users u
  ON o.user_id = u.user_id
GROUP BY 1
ORDER BY 2 DESC;
```

풀이 주석: 조인 후 집계는 실무의 기본이다. 어떤 기준으로 묶을지 먼저 정해야 한다.

---

### 14. 국가별 평균 주문 금액을 구하라
드릴다운: 각 국가의 평균 주문 금액을 비교한다.

```sql
SELECT
  u.country,
  AVG(o.amount) AS avg_amount
FROM orders o
JOIN users u
  ON o.user_id = u.user_id
WHERE o.status = 'completed'
GROUP BY 1
ORDER BY 2 DESC;
```

풀이 주석: 완료 주문만 봐야 평균 금액이 흔들리지 않는다. 상태 조건을 먼저 생각하는 습관이 중요하다.

---

### 15. 완료 주문 비율을 구하라
드릴다운: 전체 주문 중 완료 주문이 몇 퍼센트인지 본다.

```sql
SELECT
  COUNT(*) AS total_orders,
  COUNTIF(status = 'completed') AS completed_orders,
  SAFE_DIVIDE(COUNTIF(status = 'completed'), COUNT(*)) AS completed_rate
FROM orders;
```

풀이 주석: 가장 쉬운 전환율 문제다. `COUNTIF`와 `SAFE_DIVIDE`를 같이 익히면 된다.

---

### 16. 제품 카테고리별 상품 수를 구하라
드릴다운: `products`를 카테고리별로 센다.

```sql
SELECT
  category,
  COUNT(*) AS products
FROM products
GROUP BY 1
ORDER BY 2 DESC;
```

풀이 주석: 상품 수 집계는 단순하지만, 카테고리별 구조를 읽는 연습에 좋다.

---

### 17. 일자별 가입자 누적합을 구하라
드릴다운: 매일 가입자 수와 누적 가입자 수를 같이 본다.

```sql
WITH daily_signup AS (
  SELECT
    DATE(signup_at) AS signup_date,
    COUNT(*) AS signups
  FROM users
  GROUP BY 1
)
SELECT
  signup_date,
  signups,
  SUM(signups) OVER (ORDER BY signup_date) AS cumulative_signups
FROM daily_signup
ORDER BY 1;
```

풀이 주석: 누적합은 처음에는 어렵게 느껴지지만, 일자별 집계 뒤에 붙이는 것만 기억하면 된다.

---

### 18. 일자별 첫 구매 유저 수를 구하라
드릴다운: 각 유저의 첫 주문일을 구한 뒤, 날짜별로 몇 명인지 센다.

```sql
WITH first_order AS (
  SELECT
    user_id,
    MIN(DATE(order_ts)) AS first_order_date
  FROM orders
  WHERE status = 'completed'
  GROUP BY 1
)
SELECT
  first_order_date,
  COUNT(*) AS first_buyers
FROM first_order
GROUP BY 1
ORDER BY 1;
```

풀이 주석: 첫 구매는 `MIN()`으로 찾는다. 초보가 다음 단계로 넘어갈 때 꼭 익혀야 하는 패턴이다.

---

### 19. 가입 후 7일 안에 주문한 유저 수를 구하라
드릴다운: 가입 후 7일 이내 첫 주문을 한 유저만 센다.

```sql
WITH first_order AS (
  SELECT
    user_id,
    MIN(DATE(order_ts)) AS first_order_date
  FROM orders
  WHERE status = 'completed'
  GROUP BY 1
)
SELECT
  COUNT(DISTINCT u.user_id) AS users_7d_purchase
FROM users u
JOIN first_order fo
  ON u.user_id = fo.user_id
WHERE DATE_DIFF(fo.first_order_date, DATE(u.signup_at), DAY) BETWEEN 0 AND 7;
```

풀이 주석: 가입과 첫 구매 사이의 날짜 차이를 보는 문제다. 전환 속도를 보는 기초 연습으로 좋다.

---

### 20. 일자별 가입자와 주문 수를 한 번에 비교하라
드릴다운: 같은 날짜 기준으로 가입과 주문을 나란히 본다.

```sql
WITH signup_daily AS (
  SELECT DATE(signup_at) AS dt, COUNT(*) AS signups
  FROM users
  GROUP BY 1
),
order_daily AS (
  SELECT DATE(order_ts) AS dt, COUNT(*) AS orders
  FROM orders
  GROUP BY 1
)
SELECT
  s.dt,
  s.signups,
  IFNULL(o.orders, 0) AS orders
FROM signup_daily s
LEFT JOIN order_daily o USING (dt)
ORDER BY 1;
```

풀이 주석: 두 일자 집계를 나란히 붙이는 연습이다. `IFNULL`로 없는 값은 0으로 바꾼다.
