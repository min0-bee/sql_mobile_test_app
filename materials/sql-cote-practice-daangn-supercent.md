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

