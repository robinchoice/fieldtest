import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starter/app.dart';

import 'fake_api.dart';

void main() {
  testWidgets('login with code leads to the map and logout back', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    await tester.pumpWidget(ProviderScope(overrides: FakeApi().overrides, child: const App()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'robin@example.com');
    await tester.tap(find.text('Code schicken'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '123456');
    await tester.tap(find.text('Anmelden'));
    await tester.pumpAndSettle();
    expect(find.byType(FlutterMap), findsOneWidget);

    await tester.tap(find.byIcon(Icons.person_outline));
    await tester.pumpAndSettle();
    expect(find.text('robin@example.com'), findsOneWidget);

    await tester.tap(find.text('Abmelden'));
    await tester.pumpAndSettle();
    expect(find.text('Code schicken'), findsOneWidget);
  });
}
