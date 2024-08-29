window.BENCHMARK_DATA = {
  "lastUpdate": 1724954178515,
  "repoUrl": "https://github.com/CKS-Systems/manifest",
  "entries": {
    "CU Benchmark": [
      {
        "commit": {
          "author": {
            "email": "cyrbritt@gmail.com",
            "name": "Britt Cyr",
            "username": "brittcyr"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "10252b80bb50cc17bc7f201257a30e5acdb79129",
          "message": "Revert \"flip the sort order for red black tree iter (#41)\" (#44)\n\nThis reverts commit 4c94d8635e08b42f5bb3c8558d319d4a32c1b5f0.",
          "timestamp": "2024-08-29T07:58:50-04:00",
          "tree_id": "6116489f146dd3c5c4fbbd006b5af4ddb7575283",
          "url": "https://github.com/CKS-Systems/manifest/commit/10252b80bb50cc17bc7f201257a30e5acdb79129"
        },
        "date": 1724933657756,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "PHX_50",
            "value": 7003,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "PHX_95",
            "value": 13238,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "PHX_99",
            "value": 13922,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_50",
            "value": 7304,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_95",
            "value": 10386,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_99",
            "value": 12101,
            "unit": "CU",
            "range": "",
            "extra": ""
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "cyrbritt@gmail.com",
            "name": "Britt Cyr",
            "username": "brittcyr"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "d0fdb7170f04ab3a2d9d1d5ee43a11de8428b4cf",
          "message": "handle global in matching (#43)\n\n* handle global in matching\r\n\r\n* rename\r\n\r\n* fmt\r\n\r\n* test\r\n\r\n* test\r\n\r\n* fix test",
          "timestamp": "2024-08-29T12:10:23-04:00",
          "tree_id": "292506305f5d2b622b27aba9782e98e4c087e723",
          "url": "https://github.com/CKS-Systems/manifest/commit/d0fdb7170f04ab3a2d9d1d5ee43a11de8428b4cf"
        },
        "date": 1724948818527,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "PHX_50",
            "value": 7021,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "PHX_95",
            "value": 13230,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "PHX_99",
            "value": 13938,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_50",
            "value": 7345,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_95",
            "value": 10726,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_99",
            "value": 12096,
            "unit": "CU",
            "range": "",
            "extra": ""
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "mail@maximilianschneider.net",
            "name": "Maximilian Schneider",
            "username": "mschneider"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "2c0cfb8bb089f0ec8e3740fbee1fa664fb78897b",
          "message": "add regression for hypertree bug (#46)\n\nrebalance on insert would crash on uneven tree depths bc. the grand parent node would be beyond the root.\r\nadded defensive checks in rebalance for this case.\r\n\r\nalso: made verfication and debug tools accessible from fuzzer to ease integration",
          "timestamp": "2024-08-29T18:37:49+01:00",
          "tree_id": "c0c8c7c8f50cacef4f28acaaa784a94400f2cf28",
          "url": "https://github.com/CKS-Systems/manifest/commit/2c0cfb8bb089f0ec8e3740fbee1fa664fb78897b"
        },
        "date": 1724954075242,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "PHX_50",
            "value": 7021,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "PHX_95",
            "value": 13230,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "PHX_99",
            "value": 13938,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_50",
            "value": 7352,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_95",
            "value": 10710,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_99",
            "value": 12105,
            "unit": "CU",
            "range": "",
            "extra": ""
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "cyrbritt@gmail.com",
            "name": "Britt Cyr",
            "username": "brittcyr"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "2038f3cf87c6e2683f5f58485a152710f80ae8d4",
          "message": "disable some token 22 extensions (#32)\n\n* disable some token extensions\r\n\r\n* error messages",
          "timestamp": "2024-08-29T18:39:24+01:00",
          "tree_id": "8f50480173ca40fe027abd06809b95e68346c86d",
          "url": "https://github.com/CKS-Systems/manifest/commit/2038f3cf87c6e2683f5f58485a152710f80ae8d4"
        },
        "date": 1724954177731,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "PHX_50",
            "value": 7021,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "PHX_95",
            "value": 13230,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "PHX_99",
            "value": 13938,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_50",
            "value": 7337,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_95",
            "value": 10689,
            "unit": "CU",
            "range": "",
            "extra": ""
          },
          {
            "name": "MFX_99",
            "value": 12056,
            "unit": "CU",
            "range": "",
            "extra": ""
          }
        ]
      }
    ]
  }
}