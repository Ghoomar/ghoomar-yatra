import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

// Deliberately no dotenv, pg connection, Supabase client, network, or real IDs.
test("marketing SQL: synthetic transaction, reconciliation and loyalty acceptance", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  assert.equal(
    Math.floor(
      Number(
        (await db.query("select current_setting('server_version_num') as n"))
          .rows[0].n,
      ) / 10000,
    ),
    17,
    "Fixture must use PostgreSQL 17",
  );
  await db.exec(
    await readFile(
      new URL("./fixtures/marketing-base.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const name of [
    "20261106100000_marketing_foundations.sql",
    "20261106101000_marketing_transactions.sql",
    "20261106102000_marketing_import_and_reads.sql",
    "20261106103000_retire_active_footfall.sql",
  ]) {
    try {
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    } catch (error) {
      throw new Error(
        `${name}: ${error.message} (${error.position || error.where || ""})`,
      );
    }
  }
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const scalar = async (sql, params = []) =>
    Object.values((await query(sql, params))[0])[0];
  const admin = randomUUID();
  await query("insert into auth.users values($1)", [admin]);
  await query(
    "insert into profiles select $1,id,true from roles where name='Admin'",
    [admin],
  );
  await query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
  const mutate = async (action, data, key = randomUUID()) =>
    scalar("select marketing_mutate($1,$2,$3::jsonb,1)", [
      action,
      key,
      JSON.stringify(data),
    ]);
  const read = async (mode, filter = {}) =>
    scalar("select marketing_read($1,$2::jsonb)", [
      mode,
      JSON.stringify(filter),
    ]);
  const imports = async (data, key = randomUUID()) =>
    scalar("select marketing_orders_import($1,$2::jsonb)", [
      key,
      JSON.stringify(data),
    ]);
  await t.test("feature is disabled until explicitly enabled", async () => {
    assert.equal((await read("config")).enabled, false);
    await assert.rejects(mutate("register", {}), /FEATURE_DISABLED/);
  });
  await db.exec(
    "update marketing_feature_settings set enabled=true; insert into vehicle_origin_locations(name) values('Others'),('Bike'); insert into vehicle_registration_prefixes(prefix,location_name) values('UP16','Noida');",
  );
  let identity, arrival;
  await t.test(
    "registration equivalence, phone duplicate and retry",
    async () => {
      const key = randomUUID(),
        data = {
          name: "TEST Driver",
          phone: "9876543210",
          registration: "up-16 ab 0012",
          make_model: "TEST Car",
          category_code: "CAR_5",
        };
      identity = await mutate("register", data, key);
      assert.deepEqual(await mutate("register", data, key), identity);
      assert.equal(identity.vehicle.registration_normalized, "UP16AB0012");
      assert.equal(identity.driver.phone_normalized, "+919876543210");
      await assert.rejects(
        mutate("register", { ...data, phone: "+91 98765 43210" }),
        /unique/i,
      );
      await assert.rejects(
        mutate("register", { ...data, name: "Changed" }, key),
        /IDEMPOTENCY_CONFLICT/,
      );
    },
  );
  await t.test(
    "arrival counts exactly once and has no early punch",
    async () => {
      const key = randomUUID(),
        data = {
          driver_id: identity.driver.id,
          vehicle_id: identity.vehicle.id,
          brought_guests: true,
        };
      arrival = await mutate("arrival", data, key);
      assert.deepEqual(await mutate("arrival", data, key), arrival);
      assert.equal(Number(arrival.eligible_amount), 50);
      assert.equal(
        await scalar("select count(*)::int from vehicle_counter_events"),
        1,
      );
      assert.equal(
        await scalar("select count(*)::int from driver_loyalty_punches"),
        0,
      );
    },
  );
  let detail;
  await t.test(
    "bill added later: one held punch; leading zeros retained",
    async () => {
      await mutate("bill", {
        visit_id: arrival.id,
        version: 1,
        invoice_no: "001/A",
        allocated_guests: 3,
      });
      detail = await read("visit", { visit_id: arrival.id });
      assert.equal(detail.guests, 3);
      assert.equal(detail.punch.status, "HELD");
      assert.equal(detail.bills[0].state, "PENDING_IMPORT");
    },
  );
  const date = arrival.business_date;
  const order = (invoice, net = 300, status = "Success") => ({
    business_date: date,
    invoice_no: invoice,
    order_timestamp: `${date}T12:00:00+05:30`,
    hour_of_day: 12,
    status,
    order_type: "Dine In",
    payment_type: "Cash",
    covers_pax: 3,
    gross_amount: 400,
    discount_amount: 100,
    net_sales: net,
    tax_amount: 15,
    grand_total: net + 15,
    round_off: 0,
    waived_off: 0,
  });
  const payload = (orders, expected = 0) => ({
    action: "REPLACE",
    business_date: date,
    file_name: "TEST synthetic.xlsx",
    checksum: "TEST",
    metadata: { test: true },
    overwrite: true,
    expected_revision: expected,
    orders,
  });
  let imported;
  await t.test(
    "atomic import confirms recorded net revenue and punch",
    async () => {
      imported = await imports(payload([order("001/A")]));
      assert.equal(imported.success, true);
      detail = await read("visit", { visit_id: arrival.id });
      assert.equal(detail.confirmed_revenue, "300.00");
      assert.equal(detail.punch.status, "CONFIRMED");
    },
  );
  await t.test(
    "replacement retains row ID; rollback preserves prior import on error",
    async () => {
      const before = await query("select id,net_sales from sales_orders");
      await assert.rejects(
        imports(
          payload(
            [order("001/A", 500), { ...order("BAD"), hour_of_day: null }],
            1,
          ),
        ),
        /null/i,
      );
      assert.deepEqual(
        await query("select id,net_sales from sales_orders"),
        before,
      );
      await imports(payload([order("001/A", 250)], 1));
      assert.equal(
        (await query("select id from sales_orders"))[0].id,
        before[0].id,
      );
      assert.equal(
        (await read("visit", { visit_id: arrival.id })).confirmed_revenue,
        "250.00",
      );
      assert.equal(
        (await imports(payload([order("001/A")], 1))).code,
        "REVISION_CONFLICT",
      );
    },
  );
  await t.test(
    "cancellation and source deletion preserve history and hold punch",
    async () => {
      await imports(payload([order("001/A", 250, "Cancelled")], 2));
      detail = await read("visit", { visit_id: arrival.id });
      assert.equal(detail.confirmed_revenue, "0.00");
      assert.equal(detail.punch.status, "HELD");
      await imports({
        action: "DELETE",
        business_date: date,
        batch_id: imported.batch.id,
        expected_revision: 3,
      });
      detail = await read("visit", { visit_id: arrival.id });
      assert.equal(detail.bills[0].state, "SOURCE_REMOVED");
      assert.ok(detail.reconciliation_events.length >= 3);
    },
  );
  await t.test(
    "profile and reports expose current balances without inventing sales",
    async () => {
      assert.equal(
        (await read("profile", { driver_id: identity.driver.id })).cards[0]
          .held,
        1,
      );
      const report = await read("report", { from: date, to: date });
      assert.equal(report.visits, 1);
      assert.equal(Number(report.revenue), 0);
    },
  );
  await t.test(
    "driver and vehicle edits use versions and preserve arrival snapshots",
    async () => {
      await mutate("driver", {
        id: identity.driver.id,
        version: 1,
        name: "TEST Renamed",
        reason: "TEST correction",
      });
      await assert.rejects(
        mutate("driver", {
          id: identity.driver.id,
          version: 1,
          name: "Wrong",
          reason: "TEST",
        }),
        /VERSION_CONFLICT/,
      );
      await mutate("vehicle", {
        id: identity.vehicle.id,
        version: 1,
        category_code: "CAR_7",
        reason: "TEST correct category",
      });
      const visit = await read("visit", { visit_id: arrival.id });
      assert.equal(visit.driver_name_snapshot, "TEST Driver");
      assert.equal(visit.category_code, "CAR_5");
      assert.equal(Number(visit.eligible_amount), 50);
    },
  );
  await t.test(
    "split bills allocate guests once and retain a single punch",
    async () => {
      const current = await read("visit", { visit_id: arrival.id });
      await mutate("bill", {
        visit_id: arrival.id,
        version: current.version,
        invoice_no: "002",
        allocated_guests: 0,
      });
      await imports(payload([order("001/A", 300), order("002", 100)], 4));
      const visit = await read("visit", { visit_id: arrival.id });
      assert.equal(visit.guests, 3);
      assert.equal(visit.confirmed_revenue, "400.00");
      assert.equal(
        await scalar(
          "select count(*)::int from driver_loyalty_punches where visit_id=$1",
          [arrival.id],
        ),
        1,
      );
    },
  );
  await t.test(
    "duplicate sale claims hold BOTH visits; void resolves without losing history",
    async () => {
      const second = await mutate("arrival", {
        driver_id: identity.driver.id,
        vehicle_id: identity.vehicle.id,
        brought_guests: true,
      });
      await mutate("bill", {
        visit_id: second.id,
        version: 1,
        invoice_no: "001/a",
        allocated_guests: 2,
      });
      assert.equal(
        (await read("visit", { visit_id: second.id })).bills[0].state,
        "CONFLICT",
      );
      const first = await read("visit", { visit_id: arrival.id });
      assert.equal(
        first.bills.find((b) => b.invoice_no === "001/A").state,
        "CONFLICT",
      );
      assert.equal(first.punch.status, "HELD");
      await mutate("void_visit", {
        visit_id: second.id,
        version: 2,
        reason: "TEST duplicate arrival",
      });
      assert.equal(
        (await read("visit", { visit_id: arrival.id })).punch.status,
        "CONFIRMED",
      );
      assert.equal(
        await scalar(
          "select count(*)::int from vehicle_counter_events where taxi_visit_id=$1 and voided_at is not null",
          [second.id],
        ),
        1,
      );
    },
  );
  await t.test(
    "no-guest arrival earns no incentive or punch; explicit manual event attaches once",
    async () => {
      const manual = randomUUID();
      await query(
        "insert into vehicle_counter_events(id,business_date,location_id,entered_by) select $1,$2,id,$3 from vehicle_origin_locations where name='Others'",
        [manual, date, admin],
      );
      const count = await scalar(
        "select count(*)::int from vehicle_counter_events",
      );
      const visit = await mutate("arrival", {
        driver_id: identity.driver.id,
        vehicle_id: identity.vehicle.id,
        brought_guests: false,
        manual_event_id: manual,
      });
      assert.equal(Number(visit.actual_amount), 0);
      assert.equal(Number(visit.eligible_amount), 0);
      assert.equal(visit.collection_status, "NOT_APPLICABLE");
      assert.equal(
        await scalar("select count(*)::int from vehicle_counter_events"),
        count,
      );
      await assert.rejects(
        mutate("bill", {
          visit_id: visit.id,
          version: 1,
          invoice_no: "NO",
          allocated_guests: 1,
        }),
        /NO_GUEST_VISIT/,
      );
    },
  );
  await t.test(
    "incentives preserve pending vs zero and require a reason for variation",
    async () => {
      const visit = await read("visit", { visit_id: arrival.id });
      await assert.rejects(
        mutate("incentive", {
          visit_id: arrival.id,
          version: visit.version,
          collection_status: "GIVEN",
          actual_amount: "25.50",
        }),
        /REASON_REQUIRED/,
      );
      await assert.rejects(
        mutate("incentive", {
          visit_id: arrival.id,
          version: visit.version,
          collection_status: "GIVEN",
          actual_amount: "25.501",
          reason: "TEST",
        }),
        /INVALID_AMOUNT/,
      );
      await mutate("incentive", {
        visit_id: arrival.id,
        version: visit.version,
        collection_status: "GIVEN",
        actual_amount: "25.50",
        reason: "TEST partial collection",
      });
      const changed = await read("visit", { visit_id: arrival.id });
      assert.equal(changed.actual_amount, "25.50");
      await mutate("finalize", {
        visit_id: arrival.id,
        version: changed.version,
      });
    },
  );
  let openingDriver;
  await t.test(
    "verified openings: five completed cards and a partial card; no fabricated visits",
    async () => {
      openingDriver = (
        await mutate("register", {
          name: "TEST Physical Cards",
          phone: "9876543211",
          registration: "22 BH 1234 AA",
          category_code: "TRAVELLER",
        })
      ).driver;
      const data = {
          driver_id: openingDriver.id,
          saved_cards: 5,
          partial_credits: 11,
          reference: "TEST card refs",
          evidence: "TEST verified physical cards",
        },
        key = randomUUID();
      await mutate("opening", data, key);
      await mutate("opening", data, key);
      const profile = await read("profile", { driver_id: openingDriver.id });
      assert.equal(profile.cards.length, 6);
      assert.equal(profile.cards.at(-1).credits, 11);
      assert.equal(profile.visits.length, 0);
      assert.equal(profile.punches.length, 71);
    },
  );
  let redemption;
  await t.test(
    "reward consumes exact saved cards once; replay and overspend blocked",
    async () => {
      const data = {
          driver_id: openingDriver.id,
          reward_code: "WASHING_MACHINE",
          reference: "TEST reward receipt",
        },
        key = randomUUID();
      redemption = await mutate("redeem", data, key);
      assert.equal(redemption.cards.length, 5);
      assert.deepEqual(await mutate("redeem", data, key), redemption);
      await assert.rejects(
        mutate("redeem", { ...data, reward_code: "KETTLE" }),
        /INSUFFICIENT_CARDS/,
      );
    },
  );
  await t.test(
    "later reversal preserves redemption, holds future rewards, manager resolution persists",
    async () => {
      const punch = await scalar(
        "select id from driver_loyalty_punches where card_id=$1 limit 1",
        [redemption.cards[0]],
      );
      await mutate("review_punch", {
        punch_id: punch,
        version: 1,
        status: "REVERSED",
        reason: "TEST opening correction",
      });
      assert.equal(
        (await read("profile", { driver_id: openingDriver.id }))
          .redemption_exception,
        true,
      );
      await mutate("resolve_exception", {
        driver_id: openingDriver.id,
        reason: "TEST reviewed delivered reward",
      });
      await query("select marketing_refresh_cards($1)", [openingDriver.id]);
      assert.equal(
        (await read("profile", { driver_id: openingDriver.id }))
          .redemption_exception,
        false,
      );
      assert.equal(
        await scalar("select count(*)::int from driver_reward_redemptions"),
        1,
      );
    },
  );
  await t.test(
    "12th and 13th effective credits fill oldest incomplete cycle then start next",
    async () => {
      await mutate("adjust_opening", {
        driver_id: openingDriver.id,
        saved_cards: 0,
        partial_credits: 2,
        reference: "TEST correction",
        evidence: "TEST recount",
        reason: "TEST add missed physical credits",
      });
      const profile = await read("profile", { driver_id: openingDriver.id });
      assert.equal(profile.cards.at(-2).credits, 12);
      assert.equal(profile.cards.at(-1).credits, 1);
    },
  );
  await t.test(
    "metrics paginate in database, exclude bikes/buses/Lancho, distinguish missing imports",
    async () => {
      const old = "2020-01-02";
      await imports({
        ...payload(
          Array.from({ length: 1005 }, (_, i) => ({
            ...order(`TEST-${i}`, 10),
            business_date: old,
            order_timestamp: `${old}T12:00:00+05:30`,
            covers_pax: 2,
          })),
        ),
        business_date: old,
      });
      await query(
        "insert into vehicle_counter_events(business_date,location_id,vehicle_category,increment) select $1,id,'CAR',5 from vehicle_origin_locations where name='Others'",
        [old],
      );
      for (const category of ["BIKE", "BUS", "TRAVELLER"])
        await query(
          "insert into vehicle_counter_events(business_date,location_id,vehicle_category,increment) select $1,id,$2,10 from vehicle_origin_locations where name='Others'",
          [old, category],
        );
      const m = await scalar("select operating_metrics($1,$2)", [old, old]);
      assert.equal(m.covers, 2010);
      assert.equal(m.bills, 1005);
      assert.equal(Number(m.net_sales), 10050);
      assert.equal(m.cars, 5);
      assert.equal(m.spend_per_cover, "5.00");
      assert.equal(m.spend_per_car, "2010.00");
      const partial = await scalar("select operating_metrics($1,$2)", [
        old,
        "2020-01-03",
      ]);
      assert.equal(partial.complete, false);
      assert.equal(partial.spend_per_car, null);
      const zero = await scalar("select operating_metrics($1,$2)", [
        "2019-01-01",
        "2019-01-01",
      ]);
      assert.equal(zero.imported_days, 0);
      assert.equal(zero.spend_per_cover, null);
    },
  );
  await t.test(
    "gate role has limited reads and cannot redeem, edit identities, or touch finalized visits",
    async () => {
      const staff = randomUUID();
      await query("insert into auth.users values($1)", [staff]);
      await query(
        "insert into profiles select $1,id,true from roles where name='Gate Staff'",
        [staff],
      );
      await query("select set_config('request.jwt.claim.sub',$1,false)", [
        staff,
      ]);
      assert.equal(
        (await read("config")).permissions["marketing.capture"],
        true,
      );
      await assert.rejects(read("directory"), /FORBIDDEN/);
      await assert.rejects(
        mutate("redeem", {
          driver_id: openingDriver.id,
          reward_code: "IRON",
          reference: "TEST",
        }),
        /FORBIDDEN/,
      );
      await assert.rejects(
        mutate("driver", {
          id: identity.driver.id,
          version: 2,
          name: "TEST",
          reason: "TEST",
        }),
        /FORBIDDEN/,
      );
      await assert.rejects(
        mutate("bill", {
          visit_id: arrival.id,
          version: await scalar("select version from taxi_visits where id=$1", [
            arrival.id,
          ]),
          invoice_no: "TEST",
          allocated_guests: 1,
        }),
        /FORBIDDEN/,
      );
      await query("select set_config('request.jwt.claim.sub',$1,false)", [
        admin,
      ]);
    },
  );
  await t.test('all category defaults and prospective rate changes retain historical snapshots',async()=>{
    for(const [index,category,amount]of [[2,'CAR_5',50],[3,'CAR_7',100],[4,'TRAVELLER',300],[5,'BUS',600]]){
      const identity=await mutate('register',{name:`TEST Category ${index}`,phone:`987654321${index}`,registration:`TESTCAR00${index}`,category_code:category});
      const visit=await mutate('arrival',{driver_id:identity.driver.id,vehicle_id:identity.vehicle.id,brought_guests:true});
      assert.equal(Number(visit.eligible_amount),amount);
    }
    const future=await scalar("select ((now() at time zone 'Asia/Kolkata')::date+1)::text");
    await mutate('rate',{category_code:'BUS',valid_from:future,amount:'650.00',reason:'TEST future rate'});
    assert.equal(Number(await scalar("select max(eligible_amount) from taxi_visits where category_code='BUS'")),600);
    await assert.rejects(query("insert into taxi_incentive_rates(category_code,valid_from,amount) values('BUS',$1,700)",[future]),/RATE_OVERLAP/);
  });
  await t.test('manager review confirms loyalty without fabricated revenue; source changes can hold it again',async()=>{
    const visit=await mutate('arrival',{driver_id:identity.driver.id,vehicle_id:identity.vehicle.id,brought_guests:true});
    await mutate('bill',{visit_id:visit.id,version:1,invoice_no:'TEST-REVIEW',allocated_guests:2});
    const before=await read('visit',{visit_id:visit.id});
    await mutate('review_punch',{punch_id:before.punch.id,version:before.punch.version,status:'CONFIRMED',reason:'TEST physical bill verified'});
    const verified=await read('visit',{visit_id:visit.id});assert.equal(verified.punch.status,'CONFIRMED');assert.equal(verified.confirmed_revenue,'0.00');
    await imports(payload([order('001/A'),order('002'),order('TEST-REVIEW',100,'Complimentary')],5));
    const changed=await read('visit',{visit_id:visit.id});assert.equal(changed.punch.status,'HELD');assert.equal(changed.bills[0].state,'NON_SUCCESS');
  });
  await t.test('ambiguous normalized invoice matches require a real imported candidate',async()=>{
    const visit=await mutate('arrival',{driver_id:identity.driver.id,vehicle_id:identity.vehicle.id,brought_guests:true});
    await mutate('bill',{visit_id:visit.id,version:1,invoice_no:'TEST-AMB',allocated_guests:1});
    await imports(payload([order('TEST-AMB',123),order('test-amb',456)],6));
    let detail=await read('visit',{visit_id:visit.id});assert.equal(detail.bills[0].state,'AMBIGUOUS');assert.equal(detail.confirmed_revenue,'0.00');
    assert.equal(detail.bills[0].candidates.length,2);const selected=detail.bills[0].candidates.find(c=>c.invoice_no==='TEST-AMB');
    await mutate('resolve_bill',{visit_id:visit.id,version:detail.version,bill_id:detail.bills[0].id,sale_id:selected.id,reason:'TEST exact physical match'});
    detail=await read('visit',{visit_id:visit.id});assert.equal(detail.confirmed_revenue,'123.00');
    await query("update sales_orders set status='Cancelled' where id=$1",[selected.id]);
    detail=await read('visit',{visit_id:visit.id});assert.equal(detail.confirmed_revenue,'0.00');assert.equal(detail.punch.status,'HELD');
  });
  await t.test('dining metrics reject Lancho leakage, takeaway, snacks, unknown and non-success bills',async()=>{
    const day='2020-02-02';const rows=[
      {...order('DINING',90),covers_pax:3},
      {...order('LANCHO',1000),area:'LANCHO'},
      {...order('PAY-LANCHO',1000),payment_type:'UPI Lancho'},
      {...order('PARCEL',1000),area:'Parcel'},
      {...order('SNACKS',1000),order_type:'Delivery (Parcel)'},
      {...order('TAKEAWAY',1000),order_type:'Pick Up'},
      {...order('UNKNOWN',1000),order_type:null},
      {...order('CANCELLED',1000,'Cancelled')},
      {...order('FREE',1000,'Complimentary')},
    ].map(o=>({...o,business_date:day,order_timestamp:`${day}T12:00:00+05:30`}));
    await imports({...payload(rows),business_date:day});
    const metrics=await scalar('select operating_metrics($1,$2)',[day,day]);assert.equal(metrics.bills,1);assert.equal(metrics.covers,3);assert.equal(Number(metrics.net_sales),90);assert.equal(metrics.spend_per_cover,'30.00');assert.equal(metrics.spend_per_car,null);
  });
  await t.test('shared vehicles preserve explicit drivers and archived masters reject arrivals',async()=>{
    const added=await mutate('register',{name:'TEST Shared Driver',phone:'9876543216',vehicle_id:identity.vehicle.id});
    assert.equal((await read('lookup',{search:identity.vehicle.registration})).vehicles[0].drivers.length,2);
    await mutate('driver',{id:added.driver.id,version:1,is_active:false,reason:'TEST archived'});
    await assert.rejects(mutate('arrival',{driver_id:added.driver.id,vehicle_id:identity.vehicle.id,brought_guests:true}),/SELECT_ASSOCIATED_DRIVER/);
  });
  await t.test('database constraints protect card capacity and append-only evidence',async()=>{
    const p=await scalar("select jsonb_build_object('card_id',p.card_id,'opening_id',p.opening_id) from driver_loyalty_punches p join driver_loyalty_cards c on c.id=p.card_id where c.driver_id=$1 and c.cycle=6 limit 1",[openingDriver.id]);
    await assert.rejects(query("insert into driver_loyalty_punches(card_id,opening_id,source,status) values($1,$2,'OPENING_BALANCE','CONFIRMED')",[p.card_id,p.opening_id]),/CARD_OVERFLOW/);
    await assert.rejects(query('delete from marketing_audit_events'),/APPEND_ONLY_HISTORY/);
    await assert.rejects(query('delete from taxi_bill_reconciliation_events'),/APPEND_ONLY_HISTORY/);
  });
});
